/* ---------------------------------------------------------------------------
   A minimal, incremental « server-sent events » stream reader.

   The stream arrives in chunks that do not respect lines: a `data:` can be
   cut in two. The reader therefore keeps the unfinished remainder from one
   call to the next, and only yields complete lines.
--------------------------------------------------------------------------- */

export type SseParser = {
  /** Feed a chunk of text; yields the complete payloads. */
  feed(chunk: string): string[];
  /** True as soon as `data: [DONE]` has been read. */
  readonly done: boolean;
};

export function createSseParser(): SseParser {
  let buffer = "";
  let done = false;
  return {
    get done() {
      return done;
    },
    feed(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      const out: string[] = [];
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          done = true;
          continue;
        }
        if (payload) out.push(payload);
      }
      return out;
    },
  };
}

export type ToolCallFragment = { index: number; id?: string; name?: string; args?: string };

/** What a turn cost: input and output tokens, price if the provider gives
    it. OpenRouter sends it in the last chunk of the stream when asked
    (`usage: { include: true }`). */
export type Usage = { input?: number; output?: number; cost?: number };

export type Delta = {
  text: string;
  /** The reasoning tokens, when the model exposes them (effort). */
  thought?: string;
  error?: string;
  toolCalls?: ToolCallFragment[];
  finish?: string;
  usage?: Usage;
  /** The provider that served the reply — useful when a latency surprises
      (see `lib/server/provider-routing.ts`). */
  provider?: string;
};

/** Reads an OpenRouter completion chunk (OpenAI format): the added text,
    the tool call fragments, the finish reason, or the error the service
    may send mid-stream. */
export function extractDelta(payload: string): Delta {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { text: "" };
  }
  if (typeof json !== "object" || json === null) return { text: "" };
  const obj = json as {
    choices?: Array<{
      delta?: {
        content?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
        tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
      };
      finish_reason?: string | null;
    }>;
    error?: { message?: unknown };
    provider?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
  };
  if (obj.error) {
    const message = typeof obj.error.message === "string" ? obj.error.message : "Provider error";
    return { text: "", error: message };
  }
  const choice = obj.choices?.[0];
  const content = choice?.delta?.content;
  const out: Delta = { text: typeof content === "string" ? content : "" };
  if (Array.isArray(choice?.delta?.tool_calls)) {
    out.toolCalls = choice.delta.tool_calls.map((t, i) => ({
      index: typeof t.index === "number" ? t.index : i,
      ...(t.id ? { id: t.id } : {}),
      ...(t.function?.name ? { name: t.function.name } : {}),
      ...(typeof t.function?.arguments === "string" ? { args: t.function.arguments } : {}),
    }));
  }
  const thought = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
  if (typeof thought === "string" && thought) out.thought = thought;
  if (typeof choice?.finish_reason === "string") out.finish = choice.finish_reason;
  if (typeof obj.provider === "string") out.provider = obj.provider;
  if (obj.usage) {
    const u: Usage = {};
    if (typeof obj.usage.prompt_tokens === "number") u.input = obj.usage.prompt_tokens;
    if (typeof obj.usage.completion_tokens === "number") u.output = obj.usage.completion_tokens;
    if (typeof obj.usage.cost === "number") u.cost = obj.usage.cost;
    if (Object.keys(u).length) out.usage = u;
  }
  return out;
}
