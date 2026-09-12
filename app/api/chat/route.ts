import { KEY_HEADER, OPENROUTER, missingKey, openRouterHeaders } from "@/lib/server/openrouter";
import { completionBody } from "@/lib/server/openrouter-stream";

/* Relaie une completion en flux. Le corps est transmis tel quel (modele,
   messages, outils, effort) et la reponse SSE d'OpenRouter est renvoyee
   sans etre relue : le navigateur la lit avec `lib/llm/sse.ts`. Une erreur
   d'OpenRouter (cle invalide, credit epuise, modele inconnu) garde son
   statut et son message. */
export async function POST(req: Request) {
  const apiKey = req.headers.get(KEY_HEADER);
  if (!apiKey) return missingKey();

  let body: { model?: unknown; messages?: unknown; effort?: unknown; tools?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (typeof body.model !== "string" || !Array.isArray(body.messages)) {
    return Response.json({ error: { message: "Il manque le modèle ou les messages." } }, { status: 400 });
  }

  const upstream = await fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify(
      completionBody({
        model: body.model,
        messages: body.messages as never,
        effort: typeof body.effort === "string" && body.effort ? body.effort : null,
        tools: Array.isArray(body.tools) ? (body.tools as never) : undefined,
      }),
    ),
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    let message = `OpenRouter a répondu ${upstream.status}.`;
    try {
      const json = JSON.parse(text) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* corps non JSON */
    }
    return Response.json({ error: { message } }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
