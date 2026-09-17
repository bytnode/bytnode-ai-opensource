import { parseAccounts } from "@/lib/tools/exchange/accounts";
import { isAcpAgentId } from "@/lib/acp/agents";
import { runTurn, type WireEvent } from "@/lib/acp/sessions";
import { syncSkills } from "@/lib/acp/skills-sync";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { userSkills } from "@/lib/tools/skills/skill";

/* ---------------------------------------------------------------------------
   Un tour de conversation avec un agent par abonnement.

   Flux NDJSON : `{type:"session"}` d'abord (l'id a memoriser), puis les
   evenements du fil (texte, appels, resultats), les demandes de permission
   (`{type:"permission"}`, a repondre par /api/acp/permission), et `done`.
   Fermer la requete interrompt le tour.
--------------------------------------------------------------------------- */

type Body = {
  conversationId?: string;
  agent?: string;
  agentId?: string;
  workspace?: string;
  profession?: string;
  system?: string;
  text?: string;
  modelId?: string | null;
  effort?: string | null;
  mode?: string | null;
  permissionMode?: "ask" | "skip";
  sessionId?: string | null;
  firstTurn?: boolean;
  images?: string[];
  history?: string;
  exchangeAccounts?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (!body.conversationId || !isAcpAgentId(body.agent) || typeof body.text !== "string") {
    return Response.json({ error: { message: "Il manque la conversation, l'agent ou le message." } }, { status: 400 });
  }
  const agent = body.agent;
  const bytnodeKey = req.headers.get("x-bytnode-key") ?? "";
  const workspace = await resolveWorkspace(body.agentId ?? "", body.workspace);
  const profession = await loadProfession(PROJECT_ROOT, isProfessionId(body.profession) ? body.profession : DEFAULT_PROFESSION);
  try {
    /* Celles de la profession, puis les votres (`~/.bytnode-ai/skills/`). */
    const t0 = Date.now();
    await syncSkills(workspace, [...profession.skills, ...(await userSkills())]);
    console.info(`[acp] compétences synchronisées en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch {
    /* un dossier en lecture seule n'empeche pas de parler */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: WireEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* flux ferme */
        }
      };
      try {
        await runTurn(
          {
            conversationId: body.conversationId!,
            agent,
            workspace,
            origin: new URL(req.url).origin,
            bytnodeKey,
            exchangeAccounts: parseAccounts(body.exchangeAccounts),
            system: body.system ?? "",
            text: body.text!,
            modelId: body.modelId ?? null,
            effort: body.effort ?? null,
            mode: body.mode ?? null,
            permissionMode: body.permissionMode === "skip" ? "skip" : "ask",
            sessionId: body.sessionId ?? null,
            firstTurn: body.firstTurn === true,
            images: Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === "string") : [],
            history: body.history,
          },
          send,
          req.signal,
        );
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
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
