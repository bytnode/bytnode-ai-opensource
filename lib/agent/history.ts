import type { Message } from "@/lib/domain/types";
import type { Step } from "./events";

/* ---------------------------------------------------------------------------
   Replaying a conversation in the provider's format.

   An assistant message stores its STEPS: text, tool calls with their
   result. The provider, however, wants a sequence of messages —
   `assistant` with its `tool_calls`, then one `tool` message per result,
   then `assistant` again if the text resumed. That sequence is rebuilt at
   every turn; it is what lets the model remember what it read and did.
--------------------------------------------------------------------------- */

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export function stepsToMessages(m: Message): ProviderMessage[] {
  /* A compaction in progress (or left behind by a mid-turn reload) is not
     a reply: it is never replayed. */
  if (m.compacting) return [];
  if (m.role === "user") {
    /* Attached images go along with the text: the model has to see them to
       talk about them. The other files are on disk, and the text gives
       their paths. */
    const images = (m.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
    if (images.length === 0) return [{ role: "user", content: m.content }];
    return [
      {
        role: "user",
        content: [
          { type: "text", text: m.content },
          ...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.dataUrl as string } })),
        ],
      },
    ];
  }
  /* The summary of a compacted thread is not a reply from the agent: it is
     context. It is replayed as such, so the model builds on it instead of
     believing it just said it. */
  if (m.compaction) {
    return [
      {
        role: "user",
        content: `<previous_thread_summary>\n${m.content}\n</previous_thread_summary>\n\nThe conversation has been compacted: this summary replaces everything before it. Resume from here.`,
      },
    ];
  }
  const steps = m.steps;
  if (!steps || steps.length === 0) return [{ role: "assistant", content: m.content }];

  const out: ProviderMessage[] = [];
  let text = "";
  let pendingCalls: Extract<Step, { type: "tool" }>[] = [];

  const flushText = () => {
    if (text && pendingCalls.length === 0) out.push({ role: "assistant", content: text });
  };
  const flushCalls = () => {
    if (pendingCalls.length === 0) return;
    out.push({
      role: "assistant",
      content: text || null,
      tool_calls: pendingCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    });
    for (const c of pendingCalls) {
      out.push({
        role: "tool",
        tool_call_id: c.id,
        content: c.status === "running" || c.status === "pending" ? "[tool interrupted before it answered]" : (c.output ?? ""),
      });
    }
    pendingCalls = [];
    text = "";
  };

  for (const s of steps) {
    /* Neither the plan nor the reasoning go back to the model: they are
       there for the user, and replaying them would muddle the context. */
    if (s.type === "plan" || s.type === "thought") continue;
    if (s.type === "text") {
      if (pendingCalls.length > 0) flushCalls();
      text += s.text;
    } else {
      pendingCalls.push(s);
    }
  }
  if (pendingCalls.length > 0) flushCalls();
  else flushText();
  return out;
}

/* ---------------------------------------------------------------------------
   Pruning old tool results.

   ⚠️ TOOL OUTPUTS ARE WHAT FILLS THE WINDOW. A `Read` of a CSV, a verbose
   `Bash`: 40,000 characters each, replayed at every turn until the end of
   the thread. Like Claude Code or Codex, when the thread gets heavy, the
   `keep` most recent results stay whole — that is the current working set
   — and the older ones are cut down to their head plus a marker that tells
   the model to run the tool again if it misses the detail.

   Touches only the replay: the displayed thread keeps everything. Pure.
--------------------------------------------------------------------------- */

export type PruneOptions = {
  /** How many tool results, the most recent ones, stay whole. */
  keep: number;
  /** How many characters to keep at the head of a pruned result. */
  head: number;
};

export function pruneToolOutputs(messages: ProviderMessage[], opts: PruneOptions): ProviderMessage[] {
  const tools = messages.filter((m) => m.role === "tool").length;
  const cutoff = tools - opts.keep;
  if (cutoff <= 0) return messages;
  let seen = 0;
  return messages.map((m) => {
    if (m.role !== "tool") return m;
    const old = seen++ < cutoff;
    if (!old || m.content.length <= opts.head) return m;
    const more = m.content.length - opts.head;
    return {
      ...m,
      content: `${m.content.slice(0, opts.head)}
[… output pruned to free up context (${more} more characters). Run the tool again if you need the detail.]`,
    };
  });
}
