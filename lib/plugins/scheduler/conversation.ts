import type { AgentConfig, Conversation } from "@/lib/domain/types";
import { runConversationId, type RunRecord } from "./tasks";

/* ---------------------------------------------------------------------------
   A finished agent task, as the conversation the user finds in the
   sidebar: the task's instruction as the question, the agent's report as
   the answer. It is an ordinary conversation — the user can reply and the
   agent picks up from the report.

   The browser imports the runs it has not seen yet (`since`: the end of
   the last one imported). Pure, tested; used by `lib/state/scheduled-runs.ts`.
--------------------------------------------------------------------------- */

export function runConversation(run: RunRecord, agent: AgentConfig): Conversation {
  const started = Date.parse(run.startedAt);
  const finished = Date.parse(run.finishedAt);
  const day = run.finishedAt.slice(0, 10);
  return {
    id: runConversationId(run.id),
    agentId: agent.id,
    title: `${run.title} · ${day}`,
    modelId: agent.defaultModelId ?? "",
    effort: agent.defaultEffort ?? null,
    scheduled: { taskId: run.ref, runId: run.id },
    createdAt: finished,
    updatedAt: finished,
    messages: [
      { id: `${run.id}-q`, role: "user", content: run.prompt ?? run.title, createdAt: started },
      { id: `${run.id}-a`, role: "assistant", content: run.text ?? "", createdAt: finished },
    ],
  };
}

/** A scheduled task's folder in the sidebar: its reports, newest first. */
export type TaskFolder = { taskId: string; title: string; conversations: Conversation[] };

/** The date `runConversation` puts after the task's title. */
const DATE_SUFFIX = / · \d{4}-\d{2}-\d{2}$/;

/** The reports grouped by their task, one folder each — the folder of the
    latest report first. A folder is named after its task: the title of its
    newest report still in `runConversation`'s form, without the date (the
    user may have renamed some). */
export function taskFolders(conversations: Conversation[]): TaskFolder[] {
  const folders = new Map<string, TaskFolder>();
  const reports = conversations.filter((c) => c.scheduled).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const c of reports) {
    const id = c.scheduled!.taskId;
    let folder = folders.get(id);
    if (!folder) folders.set(id, (folder = { taskId: id, title: "", conversations: [] }));
    folder.conversations.push(c);
  }
  for (const folder of folders.values()) {
    const named = folder.conversations.find((c) => DATE_SUFFIX.test(c.title)) ?? folder.conversations[0];
    folder.title = named.title.replace(DATE_SUFFIX, "").trim() || named.title;
  }
  return [...folders.values()];
}

/** A report's line inside its task's folder: the folder already names the
    task, so a title in `runConversation`'s form reads as its date alone. */
export function reportLabel(c: Conversation, folder: TaskFolder): string {
  const prefix = `${folder.title} · `;
  return c.title.startsWith(prefix) && DATE_SUFFIX.test(c.title) ? c.title.slice(prefix.length) : c.title;
}

/** What to import from a batch of runs: the conversations to create (runs
    of an agent that still exists, not already there) and where the next
    import starts. */
export function importBatch(runs: RunRecord[], agents: AgentConfig[], existing: Set<string>, since: string): { conversations: Conversation[]; since: string } {
  const conversations: Conversation[] = [];
  let last = since;
  for (const run of runs) {
    if (run.finishedAt > last) last = run.finishedAt;
    const agent = agents.find((a) => a.id === run.agentId);
    if (!run.ok || !agent || existing.has(runConversationId(run.id))) continue;
    conversations.push(runConversation(run, agent));
  }
  return { conversations, since: last };
}
