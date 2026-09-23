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
