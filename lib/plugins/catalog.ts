import type { PluginManifest, PluginNeed, PluginView } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { enabledPlugins, pluginsForAgent } from "./core/state";
import { positionCalcManifest } from "./position-calc/manifest";
import { financeToolsManifest } from "./finance-tools/manifest";
import { watchlistManifest } from "./watchlist/manifest";
import { reportExportManifest } from "./report-export/manifest";
import { paperTradingManifest } from "./paper-trading/manifest";
import { schedulerManifest } from "./scheduler/manifest";
import { calendarManifest } from "./calendar/manifest";
import { portfolioManifest } from "./portfolio/manifest";

/* ---------------------------------------------------------------------------
   The plugins shipped with the app, by their manifests.

   Pure: the browser reads it (the library, the tabs, the dependency
   cascades) without loading any plugin code; the server pairs each
   manifest with its `setup` in `definitions.ts`. Adding a plugin = its
   folder under `lib/plugins/<id>/` + a line here + a line there.
--------------------------------------------------------------------------- */

export const PLUGIN_MANIFESTS: PluginManifest[] = [positionCalcManifest, financeToolsManifest, watchlistManifest, reportExportManifest, paperTradingManifest, schedulerManifest, calendarManifest, portfolioManifest];

export const pluginManifest = (id: string): PluginManifest | undefined => PLUGIN_MANIFESTS.find((m) => m.id === id);

/** The plugins an agent may use, from the settings: they travel with its
    requests (`x-plugins`). */
export const agentPlugins = (settings: Settings, agentId: string): string[] => pluginsForAgent(PLUGIN_MANIFESTS, settings.plugins, agentId);

/** The prerequisites of a plugin the user has not configured at all (an
    agent may still lack them: they are checked per agent). */
export const unmetNeeds = (settings: Settings, manifest: PluginManifest): PluginNeed[] =>
  manifest.needs.filter((n) => (n === "exchange-account" ? settings.keys.exchanges.length === 0 : !settings.keys.bytnode.trim()));

export type ViewEntry = PluginView & { plugin: PluginManifest };

/** The views of the plugins that run, for the tab bar's "+". */
export const enabledViews = (settings: Settings): ViewEntry[] =>
  enabledPlugins(PLUGIN_MANIFESTS, settings.plugins).flatMap((id) => {
    const plugin = pluginManifest(id)!;
    return plugin.views.map((v) => ({ ...v, plugin }));
  });

/** A view by its id, whatever the plugins' state. */
export const viewEntry = (id: string): ViewEntry | undefined => {
  for (const plugin of PLUGIN_MANIFESTS) {
    const v = plugin.views.find((x) => x.id === id);
    if (v) return { ...v, plugin };
  }
  return undefined;
};
