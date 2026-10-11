import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { transportHeaders, type Transport } from "@/lib/tools/transport";
import { acpModelId } from "@/lib/acp/agents";
import type { ConfirmVerdict } from "./serve-call";
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

/** Where to say « my tools are served » (`/api/acp/ready`), when the
    session that launched this server waits for it (`LATE_MCP` in
    `sessions.ts`: Codex starts its MCP servers without waiting). */
export type ReadyLink = { origin: string; id: string };

export function readyLinkFromEnv(env: Record<string, string | undefined>): ReadyLink | null {
  const { BYTNODE_AI_ORIGIN: origin, BYTNODE_AI_READY_ID: id } = env;
  return origin && id ? { origin, id } : null;
}

/** Tells the Next server the tool list has been served. Best effort: the
    waiting side gives up on its own after a few seconds. */
export async function announceReady(link: ReadyLink): Promise<void> {
  try {
    await fetch(`${link.origin}/api/acp/ready`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: link.id }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* nobody listening: the prompt goes out after its wait */
  }
}

/** Asks BytNode-AI's user to confirm a money action this server is about
    to run (`/api/acp/confirm` → `confirmCall` in `sessions.ts`). The answer
    streams (ticks while the user decides, then `done`); anything but an
    explicit `allowed: true` is a refusal — the app unreachable included. */
export async function confirmThroughApp(link: ParentLink, tool: string, args: Record<string, unknown>, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ConfirmVerdict> {
  const refused = (reason: string): ConfirmVerdict => ({ allowed: false, reason });
  try {
    const res = await fetchImpl(`${link.origin}/api/acp/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: link.conversationId, token: link.token, tool, args }),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return refused(`BytNode-AI refused to ask (${body?.error?.message ?? `status ${res.status}`}): nothing was sent.`);
    }
    let verdict: ConfirmVerdict | null = null;
    await readNdjson(res.body, (msg) => {
      if (msg.type !== "done") return false;
      verdict = msg.allowed === true ? { allowed: true } : refused(typeof msg.reason === "string" && msg.reason ? msg.reason : "Not confirmed: nothing was sent.");
      return true;
    });
    return verdict ?? refused("BytNode-AI closed the connection before the user's answer: nothing was sent.");
  } catch (e) {
    return refused(`BytNode-AI could not be asked (${e instanceof Error ? e.message : String(e)}): nothing was sent.`);
  }
}

/** Reads an NDJSON body line by line until `onLine` returns true. */
async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (msg: Record<string, unknown>) => boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line && onLine(JSON.parse(line) as Record<string, unknown>)) return;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
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
          const report = await runRemote(link, task, tasks.indexOf(task), args.context, transport, ctx.signal);
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
async function runRemote(link: ParentLink, task: SubagentTask, index: number, context: string | undefined, transport: Transport, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${link.origin}/api/acp/subagent`, {
    method: "POST",
    headers: { "content-type": "application/json", ...transportHeaders({ ...transport, openrouterKey: "" }) },
    body: JSON.stringify({
      conversationId: link.conversationId,
      token: link.token,
      profession: task.profession,
      /* Its row in the parent's thread, where its steps are shown. */
      index,
      title: task.title,
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
