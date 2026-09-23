import type { PluginDefinition } from "./core/contract";
import { positionCalcPlugin } from "./position-calc";
import { financeToolsPlugin } from "./finance-tools";
import { watchlistPlugin } from "./watchlist";
import { reportExportPlugin } from "./report-export";

/* The plugins shipped with the app, with their server side. SERVER-ONLY:
   the setups import fs, ccxt, the agent loop. Same order as the catalog. */

export const PLUGINS: PluginDefinition[] = [positionCalcPlugin, financeToolsPlugin, watchlistPlugin, reportExportPlugin];
