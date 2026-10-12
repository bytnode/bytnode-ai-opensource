import { AsyncLocalStorage } from "node:async_hooks";

/* ---------------------------------------------------------------------------
   Who is reading BytNode: an AI agent, or the app.

   The rule (2026-10-11): the AI agents read BytNode through its MCP server;
   everything else in the app — the plugins' views, their background jobs,
   the widgets — reads its REST API (data at rest) and its WebSocket (live
   prices). A plugin's tool runs the same code as its view (WatchlistShow
   prices the list like the Watchlist tab), so the runtime marks the tool's
   whole execution as an agent's (`asAgent`, `lib/plugins/core/runtime.ts`)
   and the shared price layer (`lib/plugins/shared/prices.ts`) picks its
   path from that mark. Without a mark, the reader is the app.

   SERVER ONLY.
--------------------------------------------------------------------------- */

const reader = new AsyncLocalStorage<"agent">();

/** Runs `fn` as an AI agent's reading: BytNode through MCP. */
export const asAgent = <T>(fn: () => T): T => reader.run("agent", fn);

/** True inside an agent's tool call. */
export const readingForAgent = (): boolean => reader.getStore() === "agent";
