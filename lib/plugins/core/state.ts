import type { ConfigProperty, PluginConfig, PluginManifest, PluginSettings, PluginsState } from "@/lib/domain/plugins";
import { effectivelyEnabled, requiredBy, requirementsOf } from "./graph";
import { isFrequency } from "./frequency";

/* ---------------------------------------------------------------------------
   The plugins' state, as the settings hold it (`Settings.plugins`): which
   are on, their configuration, the agents allowed to use them.

   A plugin absent from the settings is ON with its defaults: the ones
   shipped with the app work from the first launch. The configuration read
   from the settings is never trusted as is: every value is checked against
   the plugin's schema, and a missing or invalid one falls back to its
   default.

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

export const DEFAULT_SETTINGS: PluginSettings = { enabled: true, config: {}, agentIds: null };

export const pluginSettings = (state: PluginsState | undefined, id: string): PluginSettings => state?.[id] ?? DEFAULT_SETTINGS;

/** Is this value acceptable for this setting? */
export function validValue(prop: ConfigProperty, value: unknown): boolean {
  switch (prop.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (prop.type === "integer" && !Number.isInteger(value)) return false;
      if (prop.minimum !== undefined && value < prop.minimum) return false;
      if (prop.maximum !== undefined && value > prop.maximum) return false;
      return prop.enum === undefined || prop.enum.includes(value);
    case "string":
      if (typeof value !== "string") return false;
      if (prop.enum !== undefined) return prop.enum.includes(value);
      if (prop.pattern !== undefined && !new RegExp(prop.pattern).test(value)) return false;
      if (prop.format === "frequency") return isFrequency(value);
      if (prop.format === "time") return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      return true;
  }
}

export function defaultConfig(manifest: PluginManifest): PluginConfig {
  return Object.fromEntries(Object.entries(manifest.config.properties).map(([k, p]) => [k, p.default]));
}

/** The configuration a plugin runs with: its schema's keys only, each
    stored value if valid, otherwise the default. */
export function resolveConfig(manifest: PluginManifest, stored: PluginConfig | undefined): PluginConfig {
  const out: PluginConfig = {};
  for (const [key, prop] of Object.entries(manifest.config.properties)) {
    const v = stored?.[key];
    out[key] = v !== undefined && validValue(prop, v) ? v : prop.default;
  }
  return out;
}

/** The plugins that run: switched on, and every requirement too. In start
    order. */
export function enabledPlugins(manifests: PluginManifest[], state: PluginsState | undefined): string[] {
  return [...effectivelyEnabled(manifests, (id) => pluginSettings(state, id).enabled)];
}

/** The plugins an agent may use: running, and allowing this agent. */
export function pluginsForAgent(manifests: PluginManifest[], state: PluginsState | undefined, agentId: string): string[] {
  return enabledPlugins(manifests, state).filter((id) => {
    const allowed = pluginSettings(state, id).agentIds;
    return allowed === null || allowed.includes(agentId);
  });
}

/** Switches a plugin, with what that implies: turning one on turns on what
    it requires; turning one off turns off what requires it. `also`: the
    other plugins whose switch moved — the library asks before. */
export function togglePlugin(manifests: PluginManifest[], state: PluginsState, id: string, on: boolean): { state: PluginsState; also: string[] } {
  const chain = on ? requirementsOf(manifests, id) : requiredBy(manifests, id);
  const also = chain.filter((x) => pluginSettings(state, x).enabled !== on);
  const next: PluginsState = { ...state };
  for (const x of [id, ...also]) next[x] = { ...pluginSettings(state, x), enabled: on };
  return { state: next, also };
}

/** Changes one setting, keeping the others. */
export function setPluginConfig(state: PluginsState, id: string, key: string, value: string | number | boolean): PluginsState {
  const current = pluginSettings(state, id);
  return { ...state, [id]: { ...current, config: { ...current.config, [key]: value } } };
}

/** Who may use the plugin: `null` for every agent. */
export function setPluginAgents(state: PluginsState, id: string, agentIds: string[] | null): PluginsState {
  return { ...state, [id]: { ...pluginSettings(state, id), agentIds } };
}
