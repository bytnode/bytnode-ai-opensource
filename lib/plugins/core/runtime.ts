import type { AppNotification, Confirmation, PluginConfig, PluginManifest, PluginNeed, PluginStatus, PluginsState, PluginView } from "@/lib/domain/plugins";
import type { Tool } from "@/lib/tools/types";
import { resolvePolicy } from "@/lib/tools/policy";
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

   Two instances exist per machine: the Next server's (`background`: jobs,
   notifications, confirmations) and one per subscription session in its
   MCP server (tools only). They share the disk, never memory.
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
  private readonly defs = new Map<string, PluginDefinition>();
  private readonly order: string[];
  private readonly running = new Map<string, Instance>();
  /** The plugins that could not start, and on what: they are retried only
      when that changes. */
  private readonly failures = new Map<string, { status: PluginStatus; key: string }>();
  private state: PluginsState = {};
  private queue: Promise<void> = Promise.resolve();

  constructor(
    definitions: PluginDefinition[],
    private readonly env: RuntimeEnv,
  ) {
    for (const d of definitions) this.defs.set(d.manifest.id, d);
    this.order = startOrder(this.manifests);
    this.bus = new EventBus((event, e) => env.log(`[plugins] listener of ${event} failed: ${e instanceof Error ? e.message : String(e)}`));
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
    const run = this.queue.then(() => this.reconcile(state));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Stops everything (end of process, tests). */
  shutdown(): Promise<void> {
    return this.apply(Object.fromEntries(this.order.map((id) => [id, { enabled: false, config: {}, agentIds: null }])));
  }

  private async reconcile(state: PluginsState): Promise<void> {
    this.state = state;
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
        instance.tools.set(t.name, t);
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
      provide: (factory) => void (instance.service = factory as (caller: PluginContext) => unknown),
      inject: <T>(dep: string): T => {
        if (!manifest.requires.includes(dep)) throw new Error(`${id} did not declare ${dep} in \`requires\`.`);
        const service = serviceOf(dep);
        if (!service) throw new Error(`${dep} offers no service.`);
        return service(ctx) as T;
      },
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
    return this.selected(ids, needs).flatMap((id) => [...this.running.get(id)!.tools.values()]);
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
    const out: string[] = [];
    for (const id of this.selected(ids, needs)) {
      for (const render of this.running.get(id)!.prompts) {
        try {
          const text = (await render(target)).trim();
          if (text) out.push(text.length > PROMPT_LIMIT ? `${text.slice(0, PROMPT_LIMIT - 1)}…` : text);
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

