import type { PluginDefinition } from "./core/contract";

/* The plugins shipped with the app, with their server side. SERVER-ONLY:
   the setups import fs, ccxt, the agent loop. Same order as the catalog. */

export const PLUGINS: PluginDefinition[] = [];
