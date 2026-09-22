import { cancelTurn, closeConversation } from "@/lib/acp/sessions";

/* Interrupt the current turn; with `close`, also close the session
   (conversation deleted). */
export async function POST(req: Request) {
  let body: { conversationId?: string; close?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!body.conversationId) return Response.json({ error: { message: "Missing conversation." } }, { status: 400 });
  if (body.close) closeConversation(body.conversationId);
  else cancelTurn(body.conversationId);
  return Response.json({ ok: true });
}
