import { KEY_HEADER, missingKey } from "@/lib/server/openrouter";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { allTools } from "@/lib/tools/registry";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import type { ToolContext } from "@/lib/tools/types";
import type { AgentEvent } from "@/lib/agent/events";
import { parseAccountsHeader } from "@/lib/tools/exchange/accounts";

/* ---------------------------------------------------------------------------
   Executer un outil, et raconter ce qui se passe en chemin.

   La reponse est un flux NDJSON : les evenements emis pendant l'execution
   (les lignes d'un Monitor, l'etat des sous-agents), puis un dernier objet
   `{ type: "result", ... }`. Fermer la requete interrompt l'outil.
--------------------------------------------------------------------------- */

type Body = {
  name?: string;
  args?: Record<string, unknown>;
  agentId?: string;
  workspace?: string;
  model?: string;
  effort?: string | null;
  callId?: string;
  scope?: "workspace" | "disk";
  profession?: string;
};

export async function POST(req: Request) {
  const apiKey = req.headers.get(KEY_HEADER);
  if (!apiKey) return missingKey();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (!body.name || typeof body.model !== "string") {
    return Response.json({ error: { message: "Il manque le nom de l'outil ou le modèle." } }, { status: 400 });
  }
  const bytnodeKey = req.headers.get("x-bytnode-key") ?? "";
  const exchangeAccounts = parseAccountsHeader(req.headers.get("x-exchange-accounts"));
  const { tools } = await allTools({ platform: process.platform, bytnodeKey, exchangeAccounts });
  const tool = tools.find((t) => t.name === body.name);
  if (!tool) return Response.json({ error: { message: `Outil inconnu : ${body.name}` } }, { status: 404 });
  const profession = await loadProfession(PROJECT_ROOT, isProfessionId(body.profession) ? body.profession : DEFAULT_PROFESSION);

  const workspace = await resolveWorkspace(body.agentId ?? "", body.workspace);
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
      const ctx: ToolContext = {
        workspace,
        scope: body.scope === "disk" ? "disk" : "workspace",
        projectRoot: PROJECT_ROOT,
        signal: req.signal,
        emit: (e: AgentEvent) => send(e),
        depth: 0,
        llm: { apiKey, model: body.model as string, effort: body.effort ?? null },
        callId: body.callId ?? "call",
        professionSkills: profession.skills,
        bytnodeKey,
        exchangeAccounts,
      };
      try {
        const result = await tool.execute(body.args ?? {}, ctx);
        send({ type: "result", ...result });
      } catch (e) {
        send({ type: "result", ok: false, output: `L'outil a échoué : ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
