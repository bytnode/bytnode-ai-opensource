import { runSubagent } from "@/lib/acp/sessions";
import { isProfessionId } from "@/lib/professions/catalog";
import { parseAccounts } from "@/lib/tools/exchange/accounts";

/* ---------------------------------------------------------------------------
   Un sous-agent pour un agent par abonnement.

   Appele par le serveur MCP `bytnode-ai` de la conversation (outil
   Workflow), jamais par le navigateur : le corps porte le jeton que
   `sessions.ts` a glisse dans l'environnement de ce serveur, et le
   commanditaire doit etre en plein tour. La reponse est un flux NDJSON —
   une ligne `{type:"tick"}` toutes les 15 s tant que le sous-agent
   travaille (un rapport peut prendre des minutes), puis `{type:"done",
   report}` ou `{type:"error", message}`. Fermer la requete interrompt le
   sous-agent.
--------------------------------------------------------------------------- */

type Body = {
  conversationId?: string;
  token?: string;
  profession?: string;
  text?: string;
  model?: string | null;
  exchangeAccounts?: unknown;
};

const TICK = 15_000;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (!body.conversationId || !body.token || !isProfessionId(body.profession) || typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: { message: "Il manque le commanditaire, le jeton, la profession ou la tâche." } }, { status: 400 });
  }
  const input = {
    conversationId: body.conversationId,
    token: body.token,
    profession: body.profession,
    text: body.text,
    modelId: typeof body.model === "string" && body.model.trim() ? body.model.trim() : null,
    bytnodeKey: req.headers.get("x-bytnode-key") ?? "",
    exchangeAccounts: parseAccounts(body.exchangeAccounts),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* flux ferme */
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
          /* deja ferme */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
