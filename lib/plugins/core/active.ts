import type { PluginRuntime } from "./runtime";

/* The plugin runtime of THIS process — the Next server's, or the one an
   MCP server started for its subscription session — so the tool registry
   finds it without being handed it through every call. Kept on
   `globalThis`: Next may evaluate a module more than once (routes,
   development reloads), the runtime must stay one. */

const KEY = Symbol.for("bytnode-ai.plugins.runtime");

type Holder = { [KEY]?: PluginRuntime };

export const setActiveRuntime = (runtime: PluginRuntime | null): void => {
  (globalThis as Holder)[KEY] = runtime ?? undefined;
};

export const activeRuntime = (): PluginRuntime | null => (globalThis as Holder)[KEY] ?? null;

/* How THIS process reloads the plugins written by agents after one was
   activated or removed — set by whoever owns the runtime (the Next host,
   an MCP server), called by the agents' plugin tools and the routes, which
   must not import the host (it imports the tool registry). */

const RELOAD = Symbol.for("bytnode-ai.plugins.reload-user");

type ReloadHolder = { [RELOAD]?: () => Promise<void> };

export const setUserPluginsReloader = (reload: (() => Promise<void>) | null): void => {
  (globalThis as ReloadHolder)[RELOAD] = reload ?? undefined;
};

/** Reloads them now; nothing when no runtime runs here. */
export const reloadUserPlugins = async (): Promise<void> => {
  await (globalThis as ReloadHolder)[RELOAD]?.();
};
