import type { PluginDefinition } from "./core/contract";
import { positionCalcPlugin } from "./position-calc";
import { financeToolsPlugin } from "./finance-tools";
import { watchlistPlugin } from "./watchlist";
import { reportExportPlugin } from "./report-export";
import { paperTradingPlugin } from "./paper-trading";
import { schedulerPlugin } from "./scheduler";
import { portfolioPlugin } from "./portfolio";

/* The plugins shipped with the app, with their server side. SERVER-ONLY:
   the setups import fs, ccxt, the agent loop. Same order as the catalog. */

export const PLUGINS: PluginDefinition[] = [positionCalcPlugin, financeToolsPlugin, watchlistPlugin, reportExportPlugin, paperTradingPlugin, schedulerPlugin, portfolioPlugin];
