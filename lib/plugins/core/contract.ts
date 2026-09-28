import type { AgentConfig, ExchangeAccount, Profile } from "@/lib/domain/types";
import type { AppNotification, Confirmation, NotificationAction, NotificationLevel, PluginConfig, PluginManifest, PluginsState } from "@/lib/domain/plugins";
import type { Tool } from "@/lib/tools/types";
import type { Transport } from "@/lib/tools/transport";
import type { JobSpec } from "./clock";
import type { Disposer } from "./scope";
import type { PluginStore } from "./store";

/* ---------------------------------------------------------------------------
   The plugin contract.

   A plugin is a manifest (`lib/domain/plugins.ts`) and a `setup(ctx)` that
   receives the core's EXTENSION POINTS and plugs into them what it brings.
   It reaches nothing else: not the other plugins (it may use the service
   of one it declares `optional`, and must work without it), not the core's
   guarantees. Everything it registers belongs to its scope and disappears
   when it stops.

   ⚠️ EVERY PLUGIN IS INDEPENDENT. No plugin needs another one to run:
   switching one off never switches off or breaks another. What several
   plugins use lives in the core (the clock: `job`, `jobs`, `trigger`) or
   in `lib/plugins/shared/`.

   The same contract for the plugins shipped with the app and for those of
   a future library: the difference is a product decision, not a technical
   one.
--------------------------------------------------------------------------- */

/** The keys of the open app, held in the server's memory while a tab is
    open (heartbeat): the background has nothing else to work with. Never
    written to disk. */
export type Session = {
  openrouterKey: string;
  bytnodeKey: string;
  /** Every configured account: a background job picks the one it needs. */
  exchangeAccounts: ExchangeAccount[];
  agents: AgentConfig[];
  profile: Profile;
  plugins: PluginsState;
};

/** Who a prompt section is written for. */
export type PromptTarget = {
  agentId: string;
  /** `native`: our loop, with our general tools. `mcp`: a subscription
      agent, which reaches our tools through the `bytnode-ai` MCP server. */
  engine: "native" | "mcp";
  /** A sub-agent or a background run: nothing that waits for the user. */
  subagent: boolean;
};

/** What a view's action receives: the request's keys and accounts. */
export type ApiRequest = { transport: Transport; signal: AbortSignal };

export type ApiHandler = (params: Record<string, unknown>, req: ApiRequest) => Promise<unknown>;

export type NotificationInput = { title: string; body: string; level?: NotificationLevel; action?: NotificationAction };

/** A call to a tool that always asks, parked until a human decides. */
export type ConfirmationRequest = Pick<Confirmation, "tool" | "args" | "accountId" | "title" | "reason" | "payload">;

export type PromptRender = (target: PromptTarget) => string | Promise<string>;

export interface PluginContext {
  readonly id: string;
  readonly manifest: PluginManifest;
  /** True in the Next server, which runs the background; false in the MCP
      server of a subscription session, which only serves the tools. */
  readonly background: boolean;
  /** The configuration, checked against the manifest's schema. */
  config(): PluginConfig;
  /** EXTENSION POINT — a tool, with its policy (`Tool.policy`). */
  tool(tool: Tool<never>): void;
  /** EXTENSION POINT — a section of the agents' prompt, bounded. */
  prompt(render: PromptRender): void;
  /** EXTENSION POINT — a folder of `<name>/SKILL.md` skills. */
  skills(dir: string): void;
  /** EXTENSION POINT — an action the plugin's views call
      (`POST /api/plugins/<id>/<action>`). */
  api(action: string, handler: ApiHandler): void;
  /** EXTENSION POINT — the notification center. */
  notify(notification: NotificationInput): Promise<AppNotification>;
  /** EXTENSION POINT — the ONLY way for a plugin to run a tool that always
      asks (an order): the call is parked and shown to the user in the
      permission prompt; it runs only after their click. */
  confirm(request: ConfirmationRequest): Promise<Confirmation>;
  /** Called when one of this plugin's confirmations is decided (run,
      refused, expired). */
  onConfirmed(handler: (confirmation: Confirmation) => void | Promise<void>): void;
  /** EXTENSION POINT — background work on the core's clock (`clock.ts`):
      runs on the Next server only, while a tab is open, never twice at
      once, and goes when this plugin stops. */
  job(spec: JobSpec): void;
  /** EXTENSION POINT — jobs read again at every tick (a list the user
      edits, possibly from another process). */
  jobs(list: () => Promise<JobSpec[]>): void;
  /** Asks for one of this plugin's jobs to run as soon as possible — from
      any process (a tool served over MCP asks through the disk). */
  trigger(jobId: string): Promise<void>;
  /** Is one of this plugin's jobs running now (in this process)? */
  jobRunning(jobId: string): boolean;
  /** Events: `on("watchlist:changed", …)`; `emit("changed")` publishes
      `<this plugin>:changed`. */
  on(event: string, listener: (payload: unknown) => void | Promise<void>): void;
  emit(event: string, payload?: unknown): void;
  /** The service this plugin offers to the plugins that use it
      optionally. The factory receives the CALLER's context: what the
      caller registers through the service belongs to the caller's scope. */
  provide<T>(factory: (caller: PluginContext) => T): void;
  /** An optional plugin's service (declared in `optional`), if it runs —
      read at each use: it may come and go. */
  optional<T>(id: string): T | undefined;
  readonly store: PluginStore;
  /** The live session's keys, or null (no tab open). */
  session(): Session | null;
  onDispose(dispose: Disposer): void;
  log(message: string): void;
}

export type PluginDefinition = {
  manifest: PluginManifest;
  setup(ctx: PluginContext): void | Promise<void>;
};

export const definePlugin = (definition: PluginDefinition): PluginDefinition => definition;
