import { ndjsonOf, turnLogs } from "@/lib/acp/turn-stream";

/* ---------------------------------------------------------------------------
   Reading a subscription turn again after the connection broke.

   `?conversationId=…&turnId=…&from=N`: the turn's events from index N on
   (the browser counts what it already applied), then the new ones until
   `done` — the same NDJSON as `/api/acp/prompt`. 404 when the server no
   longer knows that turn (restarted, or finished long ago): the browser
   then reports the interruption as before.
--------------------------------------------------------------------------- */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") ?? "";
  const turnId = url.searchParams.get("turnId") ?? "";
  const from = Number(url.searchParams.get("from") ?? "0");
  const log = conversationId && turnId ? turnLogs.get(conversationId, turnId) : null;
  if (!log) return Response.json({ error: { message: "This turn is no longer known to the server." } }, { status: 404 });
  return ndjsonOf(log, Number.isFinite(from) ? Math.floor(from) : 0, req.signal);
}
