import { answerPermission } from "@/lib/acp/sessions";

/* The user's answer to a permission request from the agent. */
export async function POST(req: Request) {
  let body: { conversationId?: string; callId?: string; allow?: boolean; always?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!body.conversationId || !body.callId) return Response.json({ error: { message: "Missing conversation or call." } }, { status: 400 });
  const found = answerPermission(body.conversationId, body.callId, body.allow === true, body.always === true);
  return Response.json({ ok: found });
}
