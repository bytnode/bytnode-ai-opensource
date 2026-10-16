/* ---------------------------------------------------------------------------
   What the app reads of BytNode for its built-in plugins — and nothing else.

   The engine opens the app's credential on these routes only
   (`bytnode_api/services/authz`, plan "app"); the app refuses anything else
   before sending, and the relay a subscription agent's MCP server goes
   through (`app/api/bytnode/read`) refuses it too. Pure.
--------------------------------------------------------------------------- */

export type AppReadMethod = "GET" | "POST";

const GETS = new Set(["/v1/symbols", "/v1/price-change", "/v1/funding/next", "/v1/klines/history", "/v1/liquidations/cumulative/history", "/v1/snapshot"]);
const POSTS = new Set(["/v1/indicators"]);

/** True when the app may read `path` with `method` on its credential. */
export const isAppRead = (method: string, path: string): boolean => (method === "GET" ? GETS.has(path) : method === "POST" ? POSTS.has(path) : false);
