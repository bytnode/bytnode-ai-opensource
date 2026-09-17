/* ---------------------------------------------------------------------------
   Un lecteur de flux « server-sent events », minimal et incremental.

   Le flux arrive par morceaux qui ne respectent pas les lignes : un `data:`
   peut etre coupe en deux. Le lecteur garde donc le reste non termine d'un
   appel a l'autre, et ne rend que les lignes completes.
--------------------------------------------------------------------------- */

export type SseParser = {
  /** Donne un morceau de texte ; rend les charges utiles completes. */
  feed(chunk: string): string[];
  /** Vrai des que `data: [DONE]` a ete lu. */
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

/** Ce qu'un tour a coute : jetons d'entree et de sortie, prix si le
    fournisseur le donne. OpenRouter l'envoie dans le dernier morceau du
    flux quand on le demande (`usage: { include: true }`). */
export type Usage = { input?: number; output?: number; cost?: number };

export type Delta = {
  text: string;
  /** Les jetons de raisonnement, quand le modele les expose (effort). */
  thought?: string;
  error?: string;
  toolCalls?: ToolCallFragment[];
  finish?: string;
  usage?: Usage;
  /** Le fournisseur qui a servi la reponse — utile quand une latence
      surprend (voir `lib/server/provider-routing.ts`). */
  provider?: string;
};

/** Lit un morceau de completion OpenRouter (format OpenAI) : le texte ajoute,
    les fragments d'appels d'outils, la raison de fin, ou l'erreur que le
    service peut envoyer au milieu du flux. */
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
    const message = typeof obj.error.message === "string" ? obj.error.message : "Erreur du fournisseur";
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
