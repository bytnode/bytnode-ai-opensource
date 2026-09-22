import type { ExchangeAccount } from "@/lib/domain/types";
import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { acpModelId } from "@/lib/acp/agents";
import { failureBody, readTasks, reportSection, runInPool, subagentMessage, workflowDescription, workflowParameters, type SubagentTask } from "@/lib/tools/agents/subagent";

/* ---------------------------------------------------------------------------
   Workflow pour les agents par abonnement, servi en MCP.

   Le serveur MCP tourne dans un processus a part, lance par l'agent
   externe : il ne peut pas ouvrir lui-meme une session ACP. Chaque tache
   revient donc au serveur Next (`POST /api/acp/subagent`) avec le jeton de
   la conversation, et c'est `sessions.ts` qui ouvre une session jetable du
   meme agent, avec la profession demandee. Meme schema et meme rapport que
   la version OpenRouter (`lib/tools/agents/workflow.ts`) : le fil les
   affiche de la meme facon.
--------------------------------------------------------------------------- */

/** Ce que `sessions.ts` a glisse dans l'environnement du serveur. */
export type ParentLink = { conversationId: string; origin: string; token: string; agent: string };

export function parentLinkFromEnv(env: Record<string, string | undefined>): ParentLink | null {
  const { BYTNODE_AI_PARENT: conversationId, BYTNODE_AI_ORIGIN: origin, BYTNODE_AI_SUBAGENT_TOKEN: token, BYTNODE_AI_ACP_AGENT: agent } = env;
  if (!conversationId || !origin || !token || !agent) return null;
  return { conversationId, origin, token, agent };
}

type Args = { tasks: unknown; context?: string };

const MODELS_TIMEOUT = 10_000;

/** Les modeles que l'agent propose, tels qu'il les connait — pour que le
    parent puisse en choisir un par tache. Vide si le serveur ne repond pas
    a temps : l'outil reste utilisable, sans liste. */
export async function agentModels(link: ParentLink): Promise<string[]> {
  try {
    const res = await fetch(`${link.origin}/api/acp/models?agent=${encodeURIComponent(link.agent)}`, { signal: AbortSignal.timeout(MODELS_TIMEOUT) });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: Array<{ id?: unknown }> };
    const ids = (body.models ?? []).map((m) => (typeof m.id === "string" ? acpModelId(m.id) : "")).filter(Boolean);
    return ids.length === 1 && ids[0] === "default" ? [] : ids;
  } catch {
    return [];
  }
}

export function acpWorkflowTool(link: ParentLink, models: string[], bytnodeKey: string, exchangeAccounts: ExchangeAccount[]): Tool<Args> {
  return {
    name: "Workflow",
    description: workflowDescription({ kind: "list", ids: models }),
    parameters: workflowParameters({ kind: "list", ids: models }),
    async execute(args, ctx) {
      if (ctx.depth >= 1) return fail("Un sous-agent ne peut pas lancer de sous-agents.");
      const read = readTasks(args.tasks);
      if ("error" in read) return fail(read.error);
      const { tasks } = read;
      const results = await runInPool(tasks, async (task) => {
        try {
          const report = await runRemote(link, task, args.context, bytnodeKey, exchangeAccounts, ctx.signal);
          return reportSection(task, report);
        } catch (e) {
          return reportSection(task, failureBody(e instanceof Error ? e.message : String(e)));
        }
      });
      return ok(results.join("\n\n"));
    },
  };
}

/* Un sous-agent, de bout en bout : la requete NDJSON tient tant qu'il
   travaille (`tick`), puis rend son rapport ou son erreur. */
async function runRemote(link: ParentLink, task: SubagentTask, context: string | undefined, bytnodeKey: string, exchangeAccounts: ExchangeAccount[], signal: AbortSignal): Promise<string> {
  const res = await fetch(`${link.origin}/api/acp/subagent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bytnode-key": bytnodeKey },
    body: JSON.stringify({
      conversationId: link.conversationId,
      token: link.token,
      profession: task.profession,
      text: subagentMessage(task, context),
      model: task.model ?? null,
      exchangeAccounts,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Le serveur a répondu ${res.status}.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { type: string; report?: string; message?: string };
      if (msg.type === "done") return msg.report ?? "";
      if (msg.type === "error") throw new Error(msg.message ?? "unknown failure");
    }
  }
  throw new Error("Le serveur a fermé la connexion avant le rapport.");
}
