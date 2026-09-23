/* ---------------------------------------------------------------------------
   The vocabulary of plugins, shared by the server and the browser.

   A plugin is a brick that adds tools, data, background work or
   instructions to the agents without touching the core. Every plugin —
   shipped with the app or, later, from the library — follows the same
   contract: a MANIFEST (this file's shapes: identity, dependencies,
   configuration schema, views) and a server-side `setup` that plugs what it
   brings into the core's extension points (`lib/plugins/core/`).
--------------------------------------------------------------------------- */

export type PluginCategory = "market" | "portfolio" | "automation" | "tools";

export const PLUGIN_CATEGORIES: Array<{ id: PluginCategory; label: string }> = [
  { id: "market", label: "Market" },
  { id: "portfolio", label: "Portfolio and trading" },
  { id: "automation", label: "Automation" },
  { id: "tools", label: "Tools" },
];

/** A prerequisite outside the plugin system: something the user configures
    in the settings. A plugin whose need is not met for an agent gives that
    agent no tool. */
export type PluginNeed = "exchange-account" | "bytnode-key";

export const NEED_LABELS: Record<PluginNeed, string> = {
  "exchange-account": "Exchange account required",
  "bytnode-key": "BytNode key required",
};

/** One setting of a plugin: a subset of JSON Schema, rendered by the
    settings (`Field`, `Select`). `format: "agent"` offers the user's
    agents; `format: "frequency"` a schedule (`daily at 08:00`). */
export type ConfigProperty = {
  type: "string" | "number" | "integer" | "boolean";
  title: string;
  description?: string;
  default: string | number | boolean;
  enum?: Array<string | number>;
  /** The label of each `enum` value, same order. */
  enumLabels?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: "agent" | "frequency" | "time";
};

export type PluginConfigSchema = {
  type: "object";
  properties: Record<string, ConfigProperty>;
  additionalProperties?: false;
};

export type PluginConfig = Record<string, string | number | boolean>;

/** A view: a small application that opens in its own tab. */
export type PluginView = {
  /** Unique across plugins: it is the tab's identity (`portfolio`). */
  id: string;
  title: string;
  description: string;
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  /** `core`: shipped and loaded with the app; can be disabled, not removed. */
  tier: "core";
  category: PluginCategory;
  /** One line, for the library list. */
  summary: string;
  /** The full presentation, for the plugin's page. */
  description: string;
  /** The plugins it cannot run without: disabling one of them disables it. */
  requires: string[];
  /** The plugins it uses when they are there. */
  optional: string[];
  needs: PluginNeed[];
  config: PluginConfigSchema;
  views: PluginView[];
  /** What it stores on disk, in one sentence; `null`: nothing. */
  data: string | null;
};

/** A plugin's settings, in `Settings.plugins`. Absent: enabled, defaults. */
export type PluginSettings = {
  enabled: boolean;
  config: PluginConfig;
  /** The agents allowed to use it; `null`: every agent. */
  agentIds: string[] | null;
};

export type PluginsState = Record<string, PluginSettings>;

/** Where a plugin stands in the running app. */
export type PluginRunState = "active" | "disabled" | "error" | "blocked";

export type PluginStatus = {
  id: string;
  state: PluginRunState;
  /** `error`: why setup failed. `blocked`: which dependency is missing. */
  message?: string;
};

export type NotificationLevel = "info" | "success" | "warning" | "error";

/** What a notification offers to do. */
export type NotificationAction =
  | { kind: "open-view"; view: string; params?: Record<string, unknown> }
  | { kind: "confirm"; confirmationId: string }
  | { kind: "open-conversation"; conversationId: string };

export type AppNotification = {
  id: string;
  at: number;
  plugin: string;
  title: string;
  body: string;
  level: NotificationLevel;
  read: boolean;
  action?: NotificationAction;
};

/** A call to a tool that always asks, parked by a plugin until a human
    decides (`lib/plugins/core/confirmations.ts`). */
export type Confirmation = {
  id: string;
  at: number;
  plugin: string;
  /** The core tool to run: only those that always ask. */
  tool: string;
  args: Record<string, unknown>;
  /** The exchange account the call targets (its id in the settings). */
  accountId: string;
  title: string;
  /** Why the plugin asks, in one or two sentences. */
  reason: string;
  status: "pending" | "allowed" | "denied" | "expired" | "failed";
  /** The tool's output once run, or why it was not. */
  outcome?: string;
  /** What the plugin needs to record the result (a DCA plan and its due date). */
  payload?: Record<string, unknown>;
};
