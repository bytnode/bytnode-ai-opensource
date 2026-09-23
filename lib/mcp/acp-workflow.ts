import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { transportHeaders, type Transport } from "@/lib/tools/transport";
import { acpModelId } from "@/lib/acp/agents";
import { failureBody, readTasks, reportSection, runInPool, subagentMessage, workflowDescription, workflowParameters, type SubagentTask } from "@/lib/tools/agents/subagent";

/* ---------------------------------------------------------------------------
   Workflow for subscription agents, served over MCP.

   The MCP server runs in a separate process, launched by the external
   agent: it cannot open an ACP session itself. Each task therefore goes
   back to the Next server (`POST /api/acp/subagent`) with the
   conversation's token, and `sessions.ts` opens a throwaway session of the
   same agent, with the requested profession. Same schema and same report
   as the OpenRouter version (`lib/tools/agents/workflow.ts`): the thread
   shows them the same way.
--------------------------------------------------------------------------- */

/** What `sessions.ts` slipped into the server's environment. */
export type ParentLink = { conversationId: string; origin: string; token: string; agent: string };

export function parentLinkFromEnv(env: Record<string, string | undefined>): ParentLink | null {
  const { BYTNODE_AI_PARENT: conversationId, BYTNODE_AI_ORIGIN: origin, BYTNODE_AI_SUBAGENT_TOKEN: token, BYTNODE_AI_ACP_AGENT: agent } = env;
  if (!conversationId || !origin || !token || !agent) return null;
  return { conversationId, origin, token, agent };
}

type Args = { tasks: unknown; context?: string };

const MODELS_TIMEOUT = 10_000;

/** The models the agent offers, as it knows them — so the parent can pick
    one per task. Empty if the server does not answer in time: the tool
    stays usable, without a list. */
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

/** `transport`: the BytNode key, the accounts and the plugins of the
    parent, passed on to each sub-agent. */
export function acpWorkflowTool(link: ParentLink, models: string[], transport: Transport): Tool<Args> {
  return {
    name: "Workflow",
    policy: { gated: true, subagent: false },
    description: workflowDescription({ kind: "list", ids: models }),
    parameters: workflowParameters({ kind: "list", ids: models }),
    async execute(args, ctx) {
      if (ctx.depth >= 1) return fail("A sub-agent cannot launch sub-agents.");
      const read = readTasks(args.tasks);
      if ("error" in read) return fail(read.error);
      const { tasks } = read;
      const results = await runInPool(tasks, async (task) => {
        try {
          const report = await runRemote(link, task, args.context, transport, ctx.signal);
          return reportSection(task, report);
        } catch (e) {
          return reportSection(task, failureBody(e instanceof Error ? e.message : String(e)));
        }
      });
      return ok(results.join("\n\n"));
    },
  };
}

/* One sub-agent, end to end: the NDJSON request holds as long as it works
   (`tick`), then returns its report or its error. */
async function runRemote(link: ParentLink, task: SubagentTask, context: string | undefined, transport: Transport, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${link.origin}/api/acp/subagent`, {
    method: "POST",
    headers: { "content-type": "application/json", ...transportHeaders({ ...transport, openrouterKey: "" }) },
    body: JSON.stringify({
      conversationId: link.conversationId,
      token: link.token,
      profession: task.profession,
      text: subagentMessage(task, context),
      model: task.model ?? null,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `The server answered ${res.status}.`);
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
  throw new Error("The server closed the connection before the report.");
}
