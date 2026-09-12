import type { Model, Provider } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";

/* ---------------------------------------------------------------------------
   Le catalogue : ce qu'OpenRouter publie, reduit et reorganise.

   OpenRouter ne publie pas de liste d'editeurs, seulement des modeles dont
   l'id porte l'editeur en prefixe (`anthropic/claude-sonnet-4`). Le
   « fournisseur » de l'interface est donc DERIVE des ids, et les noms lisibles
   viennent d'une table : le prefixe `meta-llama` s'affiche « Meta Llama ».

   ⚠️ DEUX FORMES D'ID NE SONT PAS DES MODELES NOUVEAUX. `openai/gpt-4o:free`
   est une DECLINAISON de `openai/gpt-4o` (gratuite, par lots, avec
   raisonnement…) : elle porte la date du modele de base, et listee parmi les
   « derniers sortis » elle le doublerait. `~anthropic/claude-opus-latest` est
   un ALIAS mobile : sa date est celle de l'alias, pas d'une sortie, et son
   editeur est celui apres le tilde. Les deux restent cherchables.
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

/** Lit la reponse de `GET /api/v1/models`. Tolerant : une entree mal formee
    est ignoree, un corps mal forme donne une liste vide. */
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

/** Les derniers modeles sortis par un editeur, du plus recent au plus ancien :
    les modeles de base seulement — ni declinaisons, ni alias. */
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

/** Les niveaux d'effort, tels qu'on les nomme a l'ecran. Un niveau inconnu
    garde son nom technique. */
export const EFFORT_LABELS: Record<string, string> = {
  max: "Maximal",
  xhigh: "Très élevé",
  high: "Élevé",
  medium: "Moyen",
  low: "Faible",
  minimal: "Minimal",
  none: "Aucun",
};

export const effortLabel = (effort: string) => EFFORT_LABELS[effort] ?? effort;

/** La valeur qui coupe le raisonnement. Envoyee a OpenRouter comme
    `reasoning: { enabled: false }`, la seule forme valable pour tous les
    fournisseurs. */
export const EFFORT_OFF = "none";

/** Les niveaux a proposer pour un modele : ceux qu'il publie, puis « Aucun »
    s'il accepte de ne pas raisonner — soit parce qu'il le liste, soit parce
    que son raisonnement n'est pas obligatoire. */
export function effortOptions(model: Model): string[] {
  if (model.efforts.length === 0) return [];
  const levels = model.efforts.filter((e) => e !== EFFORT_OFF);
  const canOff = model.efforts.includes(EFFORT_OFF) || !model.reasoningMandatory;
  return canOff ? [...levels, EFFORT_OFF] : levels;
}
