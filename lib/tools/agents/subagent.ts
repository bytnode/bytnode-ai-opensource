import type { JsonSchema } from "../types";
import { PROFESSIONS, isProfessionId, professionInfo, type ProfessionId } from "@/lib/professions/catalog";

/* ---------------------------------------------------------------------------
   Sub-agents: what the two engines share.

   A sub-agent is ALWAYS one of BytNode-AI's four professions — the parent
   picks the profession by the nature of the task, and the model by its
   difficulty. This module carries what the `Workflow` tool declares to the
   model (schema, description), the frame of a sub-agent's prompt, and the
   shape of the report returned to the parent — the same for a key agent
   (the loop runs on the server) and for a subscription agent (a throwaway
   ACP session). Pure, tested.
--------------------------------------------------------------------------- */

export type SubagentTask = { title: string; prompt: string; profession: ProfessionId; model?: string };

export const CONCURRENCY = 3;
export const MAX_TASKS = 8;

/** The models the parent may give a task: any OpenRouter id (key agents),
    or its agent's list (subscription agents — empty when it could not be
    read). */
export type ModelChoice = { kind: "openrouter" } | { kind: "list"; ids: string[] };

const PROFESSION_LINE = PROFESSIONS.map((p) => `${p.id} (${p.short.toLowerCase()} — ${p.description.replace(/\.$/, "")})`).join("; ");

export function workflowDescription(models: ModelChoice): string {
  const modelRule =
    models.kind === "openrouter"
      ? "`model`: an OpenRouter model id — without `model`, yours."
      : models.ids.length
        ? `\`model\` among: ${models.ids.join(", ")} — without \`model\`, your current model.`
        : "`model`: one of your agent's models — without `model`, your current model.";
  return (
    `Delegate independent tasks to sub-agents that work in parallel (${CONCURRENCY} at a time, ${MAX_TASKS} at most) and returns their reports. ` +
    `Each sub-agent IS one of BytNode-AI's four professions, \`profession\` required: ${PROFESSION_LINE}. Pick the profession by the nature of the task. ` +
    `Pick the model by difficulty: a lighter, faster model for a simple task (collection, formatting), a strong model for a demanding one. ${modelRule} ` +
    "Give each task a title and a complete, self-contained prompt: the sub-agent does not see your conversation. It has your tools, except Workflow and anything that commits funds (it reports, it does not act on an account)."
  );
}

export function workflowParameters(models: ModelChoice): JsonSchema {
  const model: Record<string, unknown> = { type: "string", description: "The model for this task, by its difficulty (optional)." };
  if (models.kind === "list" && models.ids.length) model.enum = models.ids;
  return {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "The tasks to delegate.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title (3 to 6 words)." },
            profession: { type: "string", enum: PROFESSIONS.map((p) => p.id), description: "The sub-agent's profession." },
            prompt: { type: "string", description: "The complete instruction: context, goal, expected shape of the report." },
            model,
          },
          required: ["title", "profession", "prompt"],
        },
      },
      context: { type: "string", description: "Shared context added at the start of every task (optional)." },
    },
    required: ["tasks"],
    additionalProperties: false,
  };
}

/** The tasks, CONCURRENCY at a time, each result at its task's index. */
export async function runInPool<T>(tasks: readonly SubagentTask[], run: (task: SubagentTask, index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await run(tasks[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  return results;
}

/** The tasks of a call, in order and AT THEIR INDEX (the thread names them
    by it), bounded to MAX_TASKS — or the sentence to return to the model
    when one of them is incomplete. The schema has normally already refused
    everything; here the empty prompt is caught too. */
export function readTasks(raw: unknown): { tasks: SubagentTask[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Give at least one task, with a title, a profession (standard, analyste, strategique, quantitatif) and a prompt." };
  const tasks: SubagentTask[] = [];
  for (const [i, t] of raw.slice(0, MAX_TASKS).entries()) {
    const { title, prompt, profession, model } = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (!isProfessionId(profession)) return { error: `Task ${i + 1} has no valid profession (standard, analyste, strategique, quantitatif).` };
    if (typeof prompt !== "string" || !prompt.trim()) return { error: `Task ${i + 1} has no prompt.` };
    tasks.push({
      title: typeof title === "string" && title.trim() ? title.trim() : `Task ${i + 1}`,
      prompt,
      profession,
      ...(typeof model === "string" && model.trim() ? { model: model.trim() } : {}),
    });
  }
  return { tasks };
}

/** The frame of a sub-agent's system prompt: its profession, then what sets
    it apart from a full agent — one task, one report, no delegation, no
    funds committed. The environment (workspace, tools, skills) comes next,
    supplied by the engine. */
export function subagentFrame(profession: ProfessionId, professionPrompt: string, workspace: string): string {
  const info = professionInfo(profession);
  return [
    `You are a ${info.label} sub-agent of BytNode-AI, given one specific task by a requesting agent. Workspace: \`${workspace}\`.`,
    professionPrompt.trim(),
    [
      "## Your mission",
      "",
      "- You only have the task below: not your requester's conversation, nor the user to answer you. If a piece of information is missing, say so in your report and do your best.",
      "- You do not delegate (no sub-agents) and you never commit funds: no order, no close, no transfer — you report what you recommend.",
      "- End with a clear and complete report, in the form of your profession: it is all your requester will see. Figures, sources (tools called, files written), limits.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The message sent to the sub-agent: the shared context, then its task. */
export const subagentMessage = (task: SubagentTask, context?: string) => (context?.trim() ? `${context.trim()}\n\n${task.prompt}` : task.prompt);

/* --- The report returned to the parent --------------------------------------
   One section per task, heading `## <title> — <Profession>`. The thread
   splits it again (`parseWorkflowReport`) to show each sub-agent with its
   report, even when nothing was emitted along the way (MCP call). */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* The heading matches the catalog's labels, whatever they are: the parser
   stays in lockstep with what `reportSection` emits. */
const HEAD = new RegExp(`^## (.+?) — (${PROFESSIONS.map((p) => escapeRe(p.label)).join("|")})$`);

export const reportSection = (task: SubagentTask, body: string) => `## ${task.title.replace(/\n/g, " ")} — ${professionInfo(task.profession).label}\n\n${body.trim() || "(empty report)"}`;

/* An interruption (the user's Stop, a cancelled turn) reached the report as
   the platform's raw "signal is aborted without reason": said plainly, so the
   agent does not take it for a fault of the task. */
const ABORTED = /abort(ed)?\b|AbortError/i;
export const failureBody = (why: string) =>
  `[failed: ${ABORTED.test(why) ? "interrupted — the run was stopped before this task finished (not an error of the task)" : why}]`;

export type ReportSection = { title: string; profession: ProfessionId; body: string; failed: boolean };

export function parseWorkflowReport(output: string): ReportSection[] {
  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (!current) return;
    const body = lines.join("\n").trim();
    sections.push({ ...current, body, failed: /^\[failed: /.test(body) });
    lines.length = 0;
  };
  for (const line of output.split("\n")) {
    const m = HEAD.exec(line);
    if (m) {
      flush();
      const profession = PROFESSIONS.find((p) => p.label === m[2])?.id ?? "standard";
      current = { title: m[1], profession, body: "", failed: false };
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return sections;
}
