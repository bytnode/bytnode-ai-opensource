import { runSubagent } from "@/lib/acp/sessions";
import { isProfessionId } from "@/lib/professions/catalog";
import { readTransport } from "@/lib/tools/transport";

/* ---------------------------------------------------------------------------
   A sub-agent for a subscription agent.

   Called by the conversation's `bytnode-ai` MCP server (Workflow tool),
   never by the browser: the body carries the token that `sessions.ts`
   slipped into that server's environment, and the requesting parent must
   be in the middle of a turn. The response is an NDJSON stream — one
   `{type:"tick"}` line every 15 s while the sub-agent is working (a report
   can take minutes), then `{type:"done", report}` or `{type:"error",
   message}`. Closing the request interrupts the sub-agent.
--------------------------------------------------------------------------- */

type Body = {
  conversationId?: string;
  token?: string;
  profession?: string;
  text?: string;
  model?: string | null;
};

const TICK = 15_000;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!body.conversationId || !body.token || !isProfessionId(body.profession) || typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: { message: "Missing parent conversation, token, profession or task." } }, { status: 400 });
  }
  const { bytnodeKey, exchangeAccounts } = readTransport(req.headers);
  const input = {
    conversationId: body.conversationId,
    token: body.token,
    profession: body.profession,
    text: body.text,
    modelId: typeof body.model === "string" && body.model.trim() ? body.model.trim() : null,
    bytnodeKey,
    exchangeAccounts,
  };

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
        const report = await runSubagent(input, req.signal);
        send({ type: "done", report });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
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
