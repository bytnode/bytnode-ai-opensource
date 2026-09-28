import { confirmCall } from "@/lib/acp/sessions";

/* ---------------------------------------------------------------------------
   BytNode-AI's confirmation of a money action (PlaceOrder, ClosePosition,
   Transfer…) for a subscription agent.

   Called by the conversation's `bytnode-ai` MCP server before it runs a
   tool that always asks, never by the browser: the body carries the token
   that `sessions.ts` slipped into that server's environment. The user is
   asked in the live turn's thread (`confirmCall`). The response is an
   NDJSON stream — `{type:"tick"}` every 15 s while the user decides (a
   plain request would hit the fetch's 5-minute header timeout), then
   `{type:"done", allowed, reason?}`. Anything but `allowed: true` means the
   tool does not run.
--------------------------------------------------------------------------- */

type Body = { conversationId?: unknown; token?: unknown; tool?: unknown; args?: unknown };

const TICK = 15_000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  const { conversationId, token, tool, args } = body;
  if (typeof conversationId !== "string" || !conversationId || typeof token !== "string" || typeof tool !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(tool) || !isRecord(args)) {
    return Response.json({ error: { message: "Missing conversation, token, tool or arguments." } }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };
      const ticker = setInterval(() => send({ type: "tick" }), TICK);
      try {
        send({ type: "done", ...(await confirmCall({ conversationId, token, tool, args }, req.signal)) });
      } catch (e) {
        send({ type: "done", allowed: false, reason: `The confirmation failed (${e instanceof Error ? e.message : String(e)}): nothing was sent.` });
      } finally {
        clearInterval(ticker);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
