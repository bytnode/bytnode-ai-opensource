import type { JsonSchema, ToolResult } from "@/lib/tools/types";
import { validateArgs } from "@/lib/tools/validate";
import type { Delta } from "@/lib/llm/sse";
import type { AgentEvent } from "./events";
import type { ProviderMessage } from "./history";
import { ToolCallAccumulator, type ToolCall } from "./tool-calls";
import { MAX_ATTEMPTS, RepetitionGuard, backoffDelay, isTransient } from "./resilience";

/* ---------------------------------------------------------------------------
   The agent loop: model → tools → model, until a reply.

   It knows neither how to talk to OpenRouter nor how to execute a tool:
   both are handed to it. That is what lets it run in the browser (the main
   agent: the model via `/api/chat`, the tools via `/api/tools`, and the
   user to ask for permission) as well as on the server (a sub-agent
   launched by Workflow: everything in-process, no permission to ask). One
   loop, two wirings.

   ⚠️ THE LOOP IS BOUNDED. A model that calls a tool at every turn without
   ever concluding would run forever: beyond `maxTurns`, its tools are
   taken away for the last turn and it is left to conclude.

   ⚠️ IT HAS A SAFETY NET (see `resilience.ts`). A transient error — 429,
   502, dropped connection — is retried as long as NOTHING has been
   emitted yet: a turn is not lost to a passing overload. And the same tool
   call, with the same arguments, three times in a row, is not executed a
   fourth time: the agent receives a refusal telling it to change course.

   ⚠️ ARGUMENTS ARE CHECKED BEFORE ANYTHING ELSE (see `tools/validate.ts`).
   An ill-formed call is neither executed nor submitted to the user: the
   model receives the reason and corrects it at the next turn.
--------------------------------------------------------------------------- */

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: unknown } };

export type LoopDeps = {
  /** One model turn: yields the stream's deltas. */
  complete: (messages: ProviderMessage[], tools: ToolSpec[] | undefined, signal: AbortSignal) => AsyncIterable<Delta>;
  /** The execution of a tool. `emit` serves the events along the way
      (lines of a Monitor, progress of a sub-agent). */
  execute: (call: ToolCall, signal: AbortSignal, emit: (e: AgentEvent) => void) => Promise<ToolResult>;
  /** Asks for approval before a sensitive tool. Absent: everything is allowed. */
  permission?: (call: ToolCall) => Promise<boolean>;
  gated?: (name: string) => boolean;
  emit: (e: AgentEvent) => void;
  tools: ToolSpec[];
  maxTurns?: number;
  /** Whether the model behind `complete` accepts image input. When false
      (a sub-agent, a background run: they report in text and may run on a
      text-only model), image attachments are never pushed into the history
      sent back to the model — a text-only model would reject the turn with
      "No endpoints found that support image input". The images still reach
      the thread through `emit`. Default: true. */
  modelSeesImages?: boolean;
  signal: AbortSignal;
};

/** `finishReason`: the model's, or `max_turns` if the loop cut it off. */
export type LoopResult = { text: string; turns: number; finishReason: string };

const DEFAULT_MAX_TURNS = 40;

export async function runAgentLoop(messages: ProviderMessage[], deps: LoopDeps): Promise<LoopResult> {
  const history = messages.slice();
  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  const guard = new RepetitionGuard();
  let finalText = "";

  for (let turn = 1; ; turn++) {
    const last = turn >= maxTurns;
    const tools = last || deps.tools.length === 0 ? undefined : deps.tools;

    let text = "";
    let finish = "stop";
    const acc = new ToolCallAccumulator();
    /* What follows may be retried: we only retry if the stream produced
       nothing, otherwise text already displayed would be duplicated. */
    for (let attempt = 0; ; attempt++) {
      let emitted = false;
      try {
        for await (const d of deps.complete(history, tools, deps.signal)) {
          if (d.error) throw new Error(d.error);
          if (d.usage || d.provider) {
            deps.emit({
              type: "usage",
              usage: { ...(d.usage ?? {}), ...(d.provider ? { provider: d.provider } : {}) },
            });
          }
          /* Reasoning tokens count as a reply that started (no retry), but
             they are not shown: the reasoning stays on the provider's side. */
          if (d.thought) emitted = true;
          if (d.text) {
            emitted = true;
            text += d.text;
            deps.emit({ type: "text", text: d.text });
          }
          if (d.toolCalls) {
            emitted = true;
            acc.add(d.toolCalls);
          }
          if (d.finish) finish = d.finish;
        }
        break;
      } catch (e) {
        if (deps.signal.aborted) throw e;
        /* A text-only model: the provider refuses the whole turn as soon as
           the history holds an image ("No endpoints found that support image
           input" — a Read of a PNG, a Chart, an attached screenshot). The
           images are replaced by a note with their name and the turn is
           replayed once, instead of the task failing. */
        if (!emitted && refusesImages(e) && stripImages(history)) {
          text = "";
          acc.reset();
          attempt--;
          continue;
        }
        if (emitted || attempt + 1 >= MAX_ATTEMPTS || !isTransient(e)) throw e;
        const delay = backoffDelay(attempt);
        deps.emit({
          type: "retry",
          attempt: attempt + 1,
          of: MAX_ATTEMPTS,
          delayMs: delay,
          reason: e instanceof Error ? e.message : String(e),
        });
        await new Promise((r) => setTimeout(r, delay));
        text = "";
        acc.reset();
      }
    }
    finalText += text;

    const calls = acc.calls().filter((c) => c.name);
    if (calls.length === 0) {
      deps.emit({ type: "done", finishReason: finish });
      return { text: finalText, turns: turn, finishReason: finish };
    }
    /* The last turn had no tools any more: a model that calls some anyway
       will not get one more turn. */
    if (last) {
      deps.emit({ type: "done", finishReason: "max_turns" });
      return { text: finalText, turns: turn, finishReason: "max_turns" };
    }

    history.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.rawArgs || "{}" } })),
    });

    /* Tools run one after the other, in the requested order: an Edit that
       follows a Read must see the file as it was just read. */
    const images: Array<{ name: string; dataUrl: string }> = [];
    for (const call of calls) {
      if (deps.signal.aborted) throw new DOMException("Interrupted", "AbortError");
      deps.emit({ type: "tool_call", id: call.id, name: call.name, args: call.args });
      let result: ToolResult;
      const looping = guard.check(call);
      const malformed = invalidArgs(deps.tools, call);
      if (looping) {
        result = { ok: false, output: looping };
      } else if (malformed) {
        result = { ok: false, output: malformed };
      } else if (deps.permission && deps.gated?.(call.name) && !(await deps.permission(call))) {
        result = { ok: false, output: "Refused by the user. Do not insist: propose another approach or ask what they want." };
      } else {
        try {
          result = await deps.execute(call, deps.signal, deps.emit);
        } catch (e) {
          result = { ok: false, output: `The tool failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      /* What the thread shows: a path in the workspace (served by
         /api/files), otherwise the image itself. `name` is shown relative
         inside the workspace, absolute outside — ⚠️ absolute is `C:/…` on
         Windows but `/Users/…` on macOS: testing for a `:` alone sent
         macOS paths to /api/files, which refused them (broken image). */
      const inWorkspace = (name: string) => !/^([A-Za-z]:)?[\\/]/.test(name) && !name.startsWith("..");
      const shown = (result.attachments ?? [])
        .filter((a) => a.type === "image")
        .map((a) => ({ name: a.name, src: a.path && inWorkspace(a.name) ? `file:${a.name}` : a.dataUrl }));
      if (result.ok) guard.succeeded(call);
      deps.emit({ type: "tool_result", id: call.id, ok: result.ok, output: result.output, ...(shown.length ? { images: shown } : {}), ...(result.card ? { card: result.card } : {}) });
      history.push({ role: "tool", tool_call_id: call.id, content: result.output });
      for (const a of result.attachments ?? []) if (a.type === "image") images.push({ name: a.name, dataUrl: a.dataUrl });
    }

    /* A read image does not fit in a tool result (text only): it is shown
       to the model in a separate message, right after. A sub-agent or a
       background run reports in text — and may run on a text-only model
       that rejects image input — so their loop sets `modelSeesImages:
       false` and no image is pushed (the chart still exists on disk, and
       its path is in the tool's text). */
    if (images.length > 0 && deps.modelSeesImages !== false) {
      history.push({
        role: "user",
        content: images.flatMap((im) => [
          { type: "text" as const, text: `Image read by Read: ${im.name}` },
          { type: "image_url" as const, image_url: { url: im.dataUrl } },
        ]),
      });
    }
  }
}

/** The provider's refusal of image input by the chosen model. */
export const refusesImages = (e: unknown): boolean => /support(s)? image input|image input is not supported|does not support image/i.test(e instanceof Error ? e.message : String(e));

/** Replaces every image of the history by a text note, in place; `true`
    when there was one. */
export function stripImages(history: ProviderMessage[]): boolean {
  let found = false;
  for (const m of history) {
    if (!Array.isArray(m.content)) continue;
    const parts = m.content as Array<{ type: string; text?: string; image_url?: unknown }>;
    if (!parts.some((p) => p.type === "image_url")) continue;
    found = true;
    m.content = parts.map((p) =>
      p.type === "image_url" ? { type: "text" as const, text: "[image not shown: this model does not read images — its file path is given in the text]" } : p,
    ) as typeof m.content;
  }
  return found;
}

/** The sentence to return to the model if the call does not respect the
    tool's schema; `null` otherwise (or if the tool is unknown: execution
    will say so). */
function invalidArgs(tools: ToolSpec[], call: ToolCall): string | null {
  if (call.argsError) return `Unreadable arguments for ${call.name}: ${call.argsError}. Send the call again with a valid JSON object.`;
  const spec = tools.find((t) => t.function.name === call.name)?.function.parameters;
  if (!isSchema(spec)) return null;
  const problem = validateArgs(spec, call.args);
  return problem ? `Invalid arguments for ${call.name}: ${problem} Fix the call.` : null;
}

const isSchema = (v: unknown): v is JsonSchema =>
  typeof v === "object" && v !== null && (v as { type?: unknown }).type === "object" && typeof (v as { properties?: unknown }).properties === "object";
