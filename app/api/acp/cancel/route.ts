import { cancelTurn, closeConversation } from "@/lib/acp/sessions";

/* Interrompre le tour en cours ; avec `close`, fermer aussi la session
   (conversation supprimee). */
export async function POST(req: Request) {
  let body: { conversationId?: string; close?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (!body.conversationId) return Response.json({ error: { message: "Il manque la conversation." } }, { status: 400 });
  if (body.close) closeConversation(body.conversationId);
  else cancelTurn(body.conversationId);
  return Response.json({ ok: true });
}
