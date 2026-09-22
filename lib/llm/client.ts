import type { ProviderMessage } from "@/lib/agent/history";
import type { ToolSpec } from "@/lib/agent/loop";
import { createSseParser, extractDelta, type Delta } from "./sse";

/* ---------------------------------------------------------------------------
   The model client: one turn, streamed, with or without tools.

   It yields the raw deltas — text, tool call fragments, finish reason —
   and it is the loop (`lib/agent/loop.ts`) that makes something of them.
   `OpenRouterClient` goes through the `/api/chat` route, which relays to
   OpenRouter while keeping the key out of the request body.
--------------------------------------------------------------------------- */

export type ChatRequest = {
  model: string;
  messages: ProviderMessage[];
  tools?: ToolSpec[];
  effort?: string | null;
  signal?: AbortSignal;
};

export interface LlmClient {
  streamChat(req: ChatRequest): AsyncGenerator<Delta, void, void>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export class OpenRouterClient implements LlmClient {
  constructor(private apiKey: string) {}

  async *streamChat({ model, messages, tools, effort, signal }: ChatRequest) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-openrouter-key": this.apiKey },
      body: JSON.stringify({ model, messages, ...(tools?.length ? { tools } : {}), ...(effort ? { effort } : {}) }),
      signal,
    });

    if (!res.ok || !res.body) {
      const message = await readError(res);
      throw new LlmError(
        res.status === 401 || res.status === 403 ? `OpenRouter key refused (${message}) — check it in the settings.` : message,
        res.status,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const payload of parser.feed(decoder.decode(value, { stream: true }))) yield extractDelta(payload);
      if (parser.done) break;
    }
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } | string };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    /* non-JSON body */
  }
  return `The provider answered ${res.status}.`;
}
