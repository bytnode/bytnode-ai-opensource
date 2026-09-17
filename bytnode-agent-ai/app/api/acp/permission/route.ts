import { answerPermission } from "@/lib/acp/sessions";

/* La reponse de l'utilisateur a une demande de permission de l'agent. */
export async function POST(req: Request) {
  let body: { conversationId?: string; callId?: string; allow?: boolean; always?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (!body.conversationId || !body.callId) return Response.json({ error: { message: "Il manque la conversation ou l'appel." } }, { status: 400 });
  const found = answerPermission(body.conversationId, body.callId, body.allow === true, body.always === true);
  return Response.json({ ok: found });
}
