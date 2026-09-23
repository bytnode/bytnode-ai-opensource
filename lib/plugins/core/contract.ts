import type { AgentConfig, ExchangeAccount, Profile } from "@/lib/domain/types";
import type { AppNotification, Confirmation, NotificationAction, NotificationLevel, PluginConfig, PluginManifest, PluginsState } from "@/lib/domain/plugins";
import type { Tool } from "@/lib/tools/types";
import type { Transport } from "@/lib/tools/transport";
import type { Disposer } from "./scope";
import type { PluginStore } from "./store";

/* ---------------------------------------------------------------------------
   The plugin contract.

   A plugin is a manifest (`lib/domain/plugins.ts`) and a `setup(ctx)` that
   receives the core's EXTENSION POINTS and plugs into them what it brings.
   It reaches nothing else: not the other plugins (it asks for their
   service, which must be a declared dependency), not the core's
   guarantees. Everything it registers belongs to its scope and disappears
   when it stops.

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
  /** Events: `on("watchlist:changed", …)`; `emit("changed")` publishes
      `<this plugin>:changed`. */
  on(event: string, listener: (payload: unknown) => void | Promise<void>): void;
  emit(event: string, payload?: unknown): void;
  /** The service this plugin offers to the plugins that depend on it. The
      factory receives the CALLER's context: what the caller registers
      through the service (a job) belongs to the caller's scope. */
  provide<T>(factory: (caller: PluginContext) => T): void;
  /** A required plugin's service (declared in `requires`). */
  inject<T>(id: string): T;
  /** An optional plugin's service (declared in `optional`), if it runs. */
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
