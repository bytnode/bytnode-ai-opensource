import { markToolsReady } from "@/lib/acp/sessions";

/* Called by a subscription agent's `bytnode-ai` MCP server once it has
   served its tool list: the session that launched it waits for that before
   its first prompt (`LATE_MCP` in `lib/acp/sessions.ts` — Codex does not
   wait for its MCP servers). The id is a random one only that session and
   its server know; an unknown id changes nothing. */
export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) return Response.json({ error: { message: "Missing id." } }, { status: 400 });
  return Response.json({ ok: markToolsReady(body.id) });
}
