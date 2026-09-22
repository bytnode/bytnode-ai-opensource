import type { Model, Provider } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";

/* ---------------------------------------------------------------------------
   The catalog: what OpenRouter publishes, reduced and reorganised.

   OpenRouter publishes no list of vendors, only models whose id carries the
   vendor as a prefix (`anthropic/claude-sonnet-4`). The interface's
   « provider » is therefore DERIVED from the ids, and the readable names
   come from a table: the `meta-llama` prefix is shown as « Meta Llama ».

   ⚠️ TWO ID FORMS ARE NOT NEW MODELS. `openai/gpt-4o:free` is a VARIANT of
   `openai/gpt-4o` (free, batch, with reasoning…): it carries the base
   model's date, and listed among the « latest releases » it would
   duplicate it. `~anthropic/claude-opus-latest` is a moving ALIAS: its date
   is the alias's, not a release's, and its vendor is the one after the
   tilde. Both remain searchable.
--------------------------------------------------------------------------- */

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta Llama",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
  "x-ai": "xAI",
  qwen: "Qwen",
  cohere: "Cohere",
  perplexity: "Perplexity",
  microsoft: "Microsoft",
  amazon: "Amazon",
  nvidia: "NVIDIA",
  "moonshotai": "Moonshot AI",
  "z-ai": "Z.ai",
  minimax: "MiniMax",
  openrouter: "OpenRouter",
  inception: "Inception",
  "ai21": "AI21",
  baidu: "Baidu",
  bytedance: "ByteDance",
  tencent: "Tencent",
  nousresearch: "Nous Research",
  liquid: "Liquid",
  sao10k: "Sao10K",
  "thedrummer": "TheDrummer",
};

const providerName = (id: string) =>
  acpAgentOf(id)?.label ??
  PROVIDER_NAMES[id] ??
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Reads the response of `GET /api/v1/models`. Tolerant: a malformed entry
    is ignored, a malformed body yields an empty list. */
export function parseOpenRouterModels(raw: unknown): Model[] {
  if (!isRecord(raw) || !Array.isArray(raw.data)) return [];
  const out: Model[] = [];
  for (const entry of raw.data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const alias = entry.id.startsWith("~");
    const bare = alias ? entry.id.slice(1) : entry.id;
    const slash = bare.indexOf("/");
    if (slash <= 0) continue;
    const colon = bare.indexOf(":", slash);
    const reasoning = isRecord(entry.reasoning) ? entry.reasoning : {};
    const efforts = Array.isArray(reasoning.supported_efforts)
      ? reasoning.supported_efforts.filter((e): e is string => typeof e === "string")
      : [];
    out.push({
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name : entry.id,
      providerId: bare.slice(0, slash),
      created: typeof entry.created === "number" ? entry.created : 0,
      contextLength: typeof entry.context_length === "number" ? entry.context_length : null,
      variant: colon > 0 ? bare.slice(colon + 1) : null,
      alias,
      efforts,
      defaultEffort: typeof reasoning.default_effort === "string" && efforts.includes(reasoning.default_effort) ? reasoning.default_effort : null,
      reasoningMandatory: reasoning.mandatory === true,
    });
  }
  return out;
}

export function listProviders(models: Model[]): Provider[] {
  const counts = new Map<string, number>();
  for (const m of models) counts.set(m.providerId, (counts.get(m.providerId) ?? 0) + 1);
  return [...counts]
    .map(([id, modelCount]) => ({ id, name: providerName(id), modelCount }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const byNewest = (a: Model, b: Model) => b.created - a.created;

const ofProvider = (models: Model[], providerId: string) =>
  models.filter((m) => m.providerId === providerId).sort(byNewest);

/** The latest models released by a vendor, newest first: base models
    only — no variants, no aliases. */
export function latestModels(models: Model[], providerId: string, n = 3): Model[] {
  return ofProvider(models, providerId)
    .filter((m) => m.variant === null && !m.alias)
    .slice(0, n);
}

export function searchModels(models: Model[], providerId: string, query: string): Model[] {
  const q = query.trim().toLowerCase();
  const pool = ofProvider(models, providerId);
  if (!q) return pool;
  return pool.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
}

export function searchProviders(providers: Provider[], query: string): Provider[] {
  const q = query.trim().toLowerCase();
  if (!q) return providers;
  return providers.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
}

/** The effort levels, as they are named on screen. An unknown level keeps
    its technical name. */
export const EFFORT_LABELS: Record<string, string> = {
  max: "Max",
  xhigh: "Very high",
  high: "High",
  medium: "Medium",
  low: "Low",
  minimal: "Minimal",
  none: "None",
};

export const effortLabel = (effort: string) => EFFORT_LABELS[effort] ?? effort;

/** The value that switches reasoning off. Sent to OpenRouter as
    `reasoning: { enabled: false }`, the only form valid for every
    provider. */
export const EFFORT_OFF = "none";

/** The levels to offer for a model: the ones it publishes, then « None »
    if it accepts not to reason — either because it lists it, or because
    its reasoning is not mandatory. */
export function effortOptions(model: Model): string[] {
  if (model.efforts.length === 0) return [];
  const levels = model.efforts.filter((e) => e !== EFFORT_OFF);
  const canOff = model.efforts.includes(EFFORT_OFF) || !model.reasoningMandatory;
  return canOff ? [...levels, EFFORT_OFF] : levels;
}
