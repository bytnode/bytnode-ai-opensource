import type { Delta } from "@/lib/llm/sse";
import { createSseParser, extractDelta } from "@/lib/llm/sse";
import type { ProviderMessage } from "@/lib/agent/history";
import type { ToolSpec } from "@/lib/agent/loop";
import { OPENROUTER, openRouterHeaders } from "./openrouter";
import { PROVIDER_ROUTING } from "./provider-routing";

/* Un tour de modele chez OpenRouter, cote serveur : la requete telle que le
   relais `/api/chat` la construit, mais lue ici — c'est ce qu'un sous-agent
   utilise, sans passer par le navigateur. */

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
    /* Chez le fournisseur le plus rapide, pas au hasard : voir
       `provider-routing.ts`. */
    provider: PROVIDER_ROUTING,
    /* Le decompte de jetons et le prix, dans le dernier morceau du flux :
       c'est ce qui alimente la jauge de contexte et le coût affiché. */
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
    let message = `OpenRouter a répondu ${res.status}.`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* corps non JSON */
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
