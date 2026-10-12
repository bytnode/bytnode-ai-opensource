import type { AppNotification, Confirmation, PluginConfig, PluginManifest, PluginNeed, PluginStatus, PluginsState, PluginView } from "@/lib/domain/plugins";
import type { Tool } from "@/lib/tools/types";
import { resolvePolicy } from "@/lib/tools/policy";
import { asAgent } from "@/lib/bytnode/reader";
import { CLOCK_STORE, Clock } from "./clock";
import type { ApiHandler, ConfirmationRequest, NotificationInput, PluginContext, PluginDefinition, PromptRender, PromptTarget, Session } from "./contract";
import { EventBus } from "./events";
import { affectedBy, startOrder } from "./graph";
import { Scope } from "./scope";
import { enabledPlugins, pluginSettings, resolveConfig } from "./state";
import type { PluginStore } from "./store";

/* ---------------------------------------------------------------------------
   The plugin runtime: loads, starts, stops.

   Given the plugins' state (on / off, configuration), `apply` brings the
   running set in line: plugins that must stop are disposed (dependents
   first), plugins that must start are set up in dependency order, a plugin
   whose configuration changed restarts — with everything that uses it, so
   nobody keeps a stale service. `apply` calls are serialized.

   ⚠️ A PLUGIN NEVER TAKES THE APP DOWN. A setup that throws, or hangs past
   `setupTimeoutMs`, marks the plugin `error` (its partial registrations
   are undone) and its dependents `blocked`; everything else runs.

   ⚠️ NO PLUGIN NEEDS ANOTHER. The background every plugin uses is the
   runtime's own clock (`clock.ts`), not a plugin: switching any plugin
   off leaves every other one running. (`requires` still exists in the
   manifest's type and is honoured here, but no plugin may declare one —
   `catalog.test.ts`.)

   Two instances exist per machine: the Next server's (`background`: the
   clock ticks, notifications, confirmations) and one per subscription
   session in its MCP server (tools only; its `trigger`s reach the Next
   server's clock through the disk). They share the disk, never memory.
--------------------------------------------------------------------------- */

export type NotificationSink = { add(plugin: string, input: NotificationInput): Promise<AppNotification> };
export type ConfirmationSink = { request(plugin: string, input: ConfirmationRequest): Promise<Confirmation> };

export type RuntimeEnv = {
  background: boolean;
  /** The core tools' names: no plugin may take one. */
  reservedNames: ReadonlySet<string>;
  store(id: string): PluginStore;
  notifications: NotificationSink;
  confirmations: ConfirmationSink;
  session(): Session | null;
  log(message: string): void;
  setupTimeoutMs?: number;
};

/** What an agent has, to decide whether a plugin's needs are met. */
export type AgentNeeds = Partial<Record<PluginNeed, boolean>>;

/** A prompt section never weighs more than this. */
export const PROMPT_LIMIT = 1_200;
const SETUP_TIMEOUT = 10_000;

type Instance = {
  scope: Scope;
  config: PluginConfig;
  tools: Map<string, Tool>;
  prompts: PromptRender[];
  skills: string[];
  api: Map<string, ApiHandler>;
  service?: (caller: PluginContext) => unknown;
  confirmed?: (c: Confirmation) => void | Promise<void>;
};

export class PluginRuntime {
  readonly bus: EventBus;
  /** The background of every plugin. Ticks only where `background`. */
  readonly clock: Clock;
  private defs = new Map<string, PluginDefinition>();
  private order: string[];
  private readonly running = new Map<string, Instance>();
  /** The plugins that could not start, and on what: they are retried only
      when that changes. */
  private readonly failures = new Map<string, { status: PluginStatus; key: string }>();
  private state: PluginsState = {};
  /** A state was applied once: before that, swapping definitions starts
      nothing (the host swaps them before its first `apply`). */
  private applied = false;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    definitions: PluginDefinition[],
    private readonly env: RuntimeEnv,
  ) {
    for (const d of definitions) this.defs.set(d.manifest.id, d);
    this.order = startOrder(this.manifests);
    this.bus = new EventBus((event, e) => env.log(`[plugins] listener of ${event} failed: ${e instanceof Error ? e.message : String(e)}`));
    this.clock = new Clock({ store: env.store(CLOCK_STORE), session: () => env.session(), notify: (owner, n) => env.notifications.add(owner, n), log: (m) => env.log(m) });
    if (env.background) this.clock.start();
  }

  get manifests(): PluginManifest[] {
    return [...this.defs.values()].map((d) => d.manifest);
  }

  get background(): boolean {
    return this.env.background;
  }

  /** The state last applied: what an MCP server must start with. */
  get currentState(): PluginsState {
    return this.state;
  }

  /** Brings the running plugins in line with this state. */
  apply(state: PluginsState): Promise<void> {
    /* ⚠️ Shut down is final. A request that picked this runtime before it
       was replaced (a reload in development) would otherwise start its
       plugins again — a second scheduler clock, every job run twice. */
    if (this.closed) return this.queue;
    const run = this.queue.then(() => this.reconcile(state));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Swaps the plugins it knows — one written by an agent was activated,
      changed or removed. The ones gone or changed stop, with everything
      that uses them; then the running set is brought in line with the
      last state again, so a new one starts and a changed one restarts. */
  replaceDefinitions(definitions: PluginDefinition[]): Promise<void> {
    if (this.closed) return this.queue;
    const run = this.queue.then(async () => {
      const next = new Map(definitions.map((d) => [d.manifest.id, d]));
      const before = this.manifests;
      const stopping = new Set<string>();
      for (const [id, d] of this.defs) if (next.get(id) !== d) stopping.add(id);
      for (const id of [...stopping]) for (const user of affectedBy(before, id)) stopping.add(user);
      for (const id of [...this.order].reverse()) if (stopping.has(id)) await this.stop(id);
      /* A changed plugin gets a fresh attempt, whatever failed before. */
      for (const id of stopping) this.failures.delete(id);
      for (const id of this.failures.keys()) if (!next.has(id)) this.failures.delete(id);
      this.defs = next;
      this.order = startOrder(this.manifests);
      if (this.applied) await this.reconcile(this.state);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Stops everything, for good (replaced, end of process, tests). */
  shutdown(): Promise<void> {
    const run = this.apply(Object.fromEntries(this.order.map((id) => [id, { enabled: false, config: {}, agentIds: null }])));
    this.closed = true;
    return run.finally(() => this.clock.stop());
  }

  private async reconcile(state: PluginsState): Promise<void> {
    this.state = state;
    this.applied = true;
    const manifests = this.manifests;
    const wanted = new Set(enabledPlugins(manifests, state));
    const configOf = (id: string) => resolveConfig(this.defs.get(id)!.manifest, pluginSettings(state, id).config);
    const changed = (id: string) => JSON.stringify(configOf(id)) !== JSON.stringify(this.running.get(id)?.config);

    /* What stops: what is no longer wanted, what changed configuration,
       and everything that uses one of them. What (re)starts: every wanted
       plugin not running afterwards — plus the users of a plugin that
       starts, so an optional service appears to them. */
    const stopping = new Set<string>();
    for (const id of this.running.keys()) if (!wanted.has(id) || changed(id)) stopping.add(id);
    /* A plugin that failed and whose situation has not changed is not
       retried — nor does it restart its users at every call. */
    const starting = [...wanted].filter((id) => !this.running.has(id) && this.failures.get(id)?.key !== this.attemptKey(id, state));
    for (const id of starting) for (const user of affectedBy(manifests, id)) if (this.running.has(user)) stopping.add(user);
    for (const id of [...stopping]) for (const user of affectedBy(manifests, id)) if (this.running.has(user)) stopping.add(user);

    for (const id of [...this.order].reverse()) if (stopping.has(id)) await this.stop(id);
    for (const id of this.order) {
      if (!wanted.has(id)) {
        this.failures.delete(id);
        continue;
      }
      if (this.running.has(id)) continue;
      const key = this.attemptKey(id, state);
      if (this.failures.get(id)?.key === key) continue;
      await this.start(id, configOf(id), key);
    }
  }

  /** What a start attempt depended on: the plugin's own settings and which
      of its dependencies run. */
  private attemptKey(id: string, state: PluginsState): string {
    const m = this.defs.get(id)!.manifest;
    return JSON.stringify([pluginSettings(state, id), [...m.requires, ...m.optional].filter((d) => this.running.has(d))]);
  }

  private async start(id: string, config: PluginConfig, key: string): Promise<void> {
    const def = this.defs.get(id)!;
    const missing = def.manifest.requires.find((dep) => !this.running.has(dep));
    if (missing) {
      this.failures.set(id, { key, status: { id, state: "blocked", message: `Requires ${this.defs.get(missing)?.manifest.name ?? missing}, which is not running.` } });
      return;
    }
    const instance: Instance = { scope: new Scope(), config, tools: new Map(), prompts: [], skills: [], api: new Map() };
    const ctx = this.context(def.manifest, instance);
    this.running.set(id, instance);
    try {
      await withTimeout(Promise.resolve(def.setup(ctx)), this.env.setupTimeoutMs ?? SETUP_TIMEOUT, `${def.manifest.name}: setup took too long.`);
      this.failures.delete(id);
    } catch (e) {
      this.running.delete(id);
      await instance.scope.dispose();
      const message = e instanceof Error ? e.message : String(e);
      this.failures.set(id, { key, status: { id, state: "error", message } });
      this.env.log(`[plugins] ${id} failed to start: ${message}`);
    }
  }

  private async stop(id: string): Promise<void> {
    const instance = this.running.get(id);
    if (!instance) return;
    this.running.delete(id);
    const errors = await instance.scope.dispose();
    for (const e of errors) this.env.log(`[plugins] ${id}: while stopping: ${e}`);
  }

  private context(manifest: PluginManifest, instance: Instance): PluginContext {
    const id = manifest.id;
    const env = this.env;
    const serviceOf = (dep: string) => this.running.get(dep)?.service;
    const ctx: PluginContext = {
      id,
      manifest,
      background: env.background,
      config: () => instance.config,
      tool: (tool) => {
        const t = tool as unknown as Tool;
        if (env.reservedNames.has(t.name)) throw new Error(`The tool name ${t.name} belongs to the core.`);
        const owner = this.ownerOf(t.name);
        if (owner) throw new Error(`The tool name ${t.name} is already taken by ${owner}.`);
        /* A tool is an AI agent's call: what it reads of BytNode goes
           through MCP, not the app's REST and WebSocket (`lib/bytnode/reader.ts`). */
        instance.tools.set(t.name, { ...t, execute: (args, c) => asAgent(() => t.execute(args, c)) });
      },
      prompt: (render) => void instance.prompts.push(render),
      skills: (dir) => void instance.skills.push(dir),
      api: (action, handler) => {
        if (!/^[a-z][a-z0-9-]*$/.test(action)) throw new Error(`Invalid action name: ${action}`);
        instance.api.set(action, handler);
      },
      notify: (n) => env.notifications.add(id, n),
      confirm: (request) => env.confirmations.request(id, request),
      onConfirmed: (handler) => void (instance.confirmed = handler),
      on: (event, listener) => instance.scope.add(this.bus.on(event, listener)),
      emit: (event, payload) => this.bus.emit(`${id}:${event}`, payload),
      job: (spec) => instance.scope.add(this.clock.register(`${id}:${spec.id}`, id, spec)),
      jobs: (list) => instance.scope.add(this.clock.source(id, list)),
      trigger: (jobId) => this.clock.trigger(`${id}:${jobId}`),
      jobRunning: (jobId) => this.clock.isRunning(`${id}:${jobId}`),
      provide: (factory) => void (instance.service = factory as (caller: PluginContext) => unknown),
      optional: <T>(dep: string): T | undefined => {
        if (!manifest.optional.includes(dep)) throw new Error(`${id} did not declare ${dep} in \`optional\`.`);
        const service = serviceOf(dep);
        return service ? (service(ctx) as T) : undefined;
      },
      store: env.store(id),
      session: () => env.session(),
      onDispose: (dispose) => instance.scope.add(dispose),
      log: (message) => env.log(`[plugin ${id}] ${message}`),
    };
    return ctx;
  }

  private ownerOf(toolName: string): string | undefined {
    for (const [id, instance] of this.running) if (instance.tools.has(toolName)) return id;
    return undefined;
  }

  /* --- What the rest of the app asks ------------------------------------- */

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  status(): PluginStatus[] {
    return this.order.map((id) => (this.running.has(id) ? { id, state: "active" } : (this.failures.get(id)?.status ?? { id, state: "disabled" })));
  }

  /** The running plugins among `ids` (`null`: all), whose needs this agent
      meets, in start order. */
  private selected(ids: string[] | null, needs?: AgentNeeds): string[] {
    return this.order.filter((id) => {
      if (!this.running.has(id) || (ids !== null && !ids.includes(id))) return false;
      return !needs || this.defs.get(id)!.manifest.needs.every((n) => needs[n] === true);
    });
  }

  tools(ids: string[] | null, needs?: AgentNeeds): Tool[] {
    return this.selected(ids, needs).flatMap((id) => this.toolsOf(id));
  }

  /** The plugins an agent actually has: running, enabled for it, needs met. */
  forAgent(ids: string[] | null, needs?: AgentNeeds): string[] {
    return this.selected(ids, needs);
  }

  /** A running plugin's tools (none when it does not run). */
  toolsOf(id: string): Tool[] {
    return [...(this.running.get(id)?.tools.values() ?? [])];
  }

  /** Every tool of a running plugin, with its plugin: the library shows
      them with their policy. */
  toolsByPlugin(): Array<{ plugin: string; tool: Tool }> {
    return this.order.flatMap((id) => [...(this.running.get(id)?.tools.values() ?? [])].map((tool) => ({ plugin: id, tool })));
  }

  /** The tools that always ask beyond the core's floor. */
  alwaysAskTools(): string[] {
    return this.toolsByPlugin()
      .filter(({ tool }) => resolvePolicy(tool.name, tool.policy).alwaysAsk)
      .map(({ tool }) => tool.name);
  }

  views(ids: string[] | null): PluginView[] {
    return this.selected(ids).flatMap((id) => this.defs.get(id)!.manifest.views);
  }

  /** The prompt sections of these plugins, each bounded; a section that
      fails is left out. */
  async prompts(ids: string[] | null, target: PromptTarget, needs?: AgentNeeds): Promise<string[]> {
    return (await this.promptSections(ids, target, needs)).map((s) => s.text);
  }

  /** The same sections, each with the plugin that wrote it. */
  async promptSections(ids: string[] | null, target: PromptTarget, needs?: AgentNeeds): Promise<Array<{ id: string; text: string }>> {
    const out: Array<{ id: string; text: string }> = [];
    for (const id of this.selected(ids, needs)) {
      for (const render of this.running.get(id)!.prompts) {
        try {
          const text = (await render(target)).trim();
          if (text) out.push({ id, text: text.length > PROMPT_LIMIT ? `${text.slice(0, PROMPT_LIMIT - 1)}…` : text });
        } catch (e) {
          this.env.log(`[plugins] ${id}: prompt section failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return out;
  }

  skillDirs(ids: string[] | null): string[] {
    return this.selected(ids).flatMap((id) => this.running.get(id)!.skills);
  }

  handler(id: string, action: string): ApiHandler | undefined {
    return this.running.get(id)?.api.get(action);
  }

  /** Tells the plugin that one of its confirmations was decided. */
  async confirmed(confirmation: Confirmation): Promise<void> {
    await this.running.get(confirmation.plugin)?.confirmed?.(confirmation);
  }

  /** Stops the plugin (and its users), deletes its data, starts again. */
  async clearData(id: string): Promise<void> {
    const state = this.state;
    await this.apply({ ...state, [id]: { ...pluginSettings(state, id), enabled: false } });
    await this.env.store(id).clear();
    await this.apply(state);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

