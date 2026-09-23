import type { PluginManifest } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { pluginsForAgent } from "./core/state";
import { positionCalcManifest } from "./position-calc/manifest";

/* ---------------------------------------------------------------------------
   The plugins shipped with the app, by their manifests.

   Pure: the browser reads it (the library, the tabs, the dependency
   cascades) without loading any plugin code; the server pairs each
   manifest with its `setup` in `definitions.ts`. Adding a plugin = its
   folder under `lib/plugins/<id>/` + a line here + a line there.
--------------------------------------------------------------------------- */

export const PLUGIN_MANIFESTS: PluginManifest[] = [positionCalcManifest];

export const pluginManifest = (id: string): PluginManifest | undefined => PLUGIN_MANIFESTS.find((m) => m.id === id);

/** The plugins an agent may use, from the settings: they travel with its
    requests (`x-plugins`). */
export const agentPlugins = (settings: Settings, agentId: string): string[] => pluginsForAgent(PLUGIN_MANIFESTS, settings.plugins, agentId);
