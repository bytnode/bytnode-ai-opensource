import type { Delta } from "@/lib/llm/sse";
import { createSseParser, extractDelta } from "@/lib/llm/sse";
import type { ProviderMessage } from "@/lib/agent/history";
import type { ToolSpec } from "@/lib/agent/loop";
import { OPENROUTER, openRouterHeaders } from "./openrouter";
import { PROVIDER_ROUTING } from "./provider-routing";

/* A model turn at OpenRouter, server-side: the request as the `/api/chat`
   relay builds it, but read here — this is what a sub-agent uses, without
   going through the browser. */

export type StreamParams = {
  apiKey: string;
  model: string;
  effort: string | null;
  messages: ProviderMessage[];
  tools?: ToolSpec[];
  signal: AbortSignal;
};

export function completionBody(p: Omit<StreamParams, "apiKey" | "signal">) {
  return {
    model: p.model,
    messages: p.messages,
    stream: true,
    /* At the fastest provider, not at random: see `provider-routing.ts`. */
    provider: PROVIDER_ROUTING,
    /* The token count and the price, in the last chunk of the stream: this
       is what feeds the context meter and the displayed cost. */
    usage: { include: true },
    stream_options: { include_usage: true },
    ...(p.tools?.length ? { tools: p.tools, tool_choice: "auto" } : {}),
    ...(p.effort ? { reasoning: p.effort === "none" ? { enabled: false } : { effort: p.effort } } : {}),
  };
}

export async function* streamOpenRouter(p: StreamParams): AsyncGenerator<Delta, void, void> {
  const res = await fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(p.apiKey),
    body: JSON.stringify(completionBody(p)),
    signal: p.signal,
  });
  if (!res.ok || !res.body) {
    let message = `OpenRouter answered ${res.status}.`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* non-JSON body */
    }
    throw new Error(message);
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
