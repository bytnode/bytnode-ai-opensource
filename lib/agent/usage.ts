import type { UsageInfo } from "./events";

/* ---------------------------------------------------------------------------
   Ce qu'un tour a consomme, et ou en est la fenetre de contexte.

   ⚠️ CETTE INFORMATION ARRIVE DEJA, ELLE ETAIT JETEE. OpenRouter met le
   decompte de jetons et le prix dans le dernier morceau du flux ; un agent
   par abonnement envoie des `usage_update` avec le contexte occupe, la
   taille de sa fenetre et le cout. Sans affichage, l'utilisateur ne sait ni
   ce qu'il depense, ni quand compacter — il decouvre le mur.

   Pur : la mise en forme et les seuils, testes. Le fil s'en sert pour la
   jauge en bas a droite.
--------------------------------------------------------------------------- */

/** Un ordre de grandeur, quand le vrai decompte n'est pas encore arrive :
    ~3,6 caracteres par jeton en français (un peu moins qu'en anglais). */
export const estimateTokens = (text: string) => Math.round(text.length / 3.6);

/** Le dernier decompte connu, champ par champ. `addCost` cumule le prix des
    tours successifs au lieu de le remplacer. */
export function mergeUsage(prev: UsageInfo | undefined, next: UsageInfo, opts: { addCost?: boolean } = {}): UsageInfo {
  const out: UsageInfo = { ...prev, ...next };
  if (opts.addCost && typeof prev?.cost === "number" && typeof next.cost === "number") out.cost = prev.cost + next.cost;
  return out;
}

/** Le poids du prompt systeme, des specifications d'outils et de la liste
    des competences : ce qui part a chaque tour AVANT les messages. Mesure
    sur notre jeu d'outils (~8 900 jetons d'entree pour une conversation
    vide) ; c'est un ordre de grandeur, affiche avec un `~`. */
export const PROMPT_OVERHEAD = 8_500;

/** Le contexte estime : ce que pese le fil, plus l'ossature. Sert tant
    qu'aucun decompte exact n'est arrive, et pendant qu'une reponse
    s'ecrit. */
export function contextEstimate(messages: Array<{ content: string }>, overhead = PROMPT_OVERHEAD): number {
  return overhead + messages.reduce((n, m) => n + estimateTokens(m.content), 0);
}

export type UsageState = {
  /** Jetons occupes par le fil, tel qu'il repartira au prochain tour. */
  context: number | null;
  window: number | null;
  /** Part de la fenetre occupee, entre 0 et 1. */
  part: number | null;
  level: "ok" | "warn" | "full";
  cost: number | null;
  provider: string | null;
  /** Le contexte affiche est une estimation, pas un decompte du service. */
  estimated: boolean;
};

const WARN = 0.7;
const FULL = 0.9;

/** L'etat de la jauge. `windowFallback` vient du catalogue (longueur de
    contexte du modele) quand l'agent ne l'annonce pas lui-meme. */
export function usageState(usage: UsageInfo | undefined, windowFallback: number | null, estimate?: number | null): UsageState {
  const exact =
    typeof usage?.context === "number"
      ? usage.context
      : typeof usage?.input === "number"
        ? usage.input + (usage.output ?? 0)
        : null;
  const context = exact ?? (typeof estimate === "number" ? estimate : null);
  const window = typeof usage?.window === "number" ? usage.window : windowFallback;
  const part = context !== null && window ? context / window : null;
  return {
    context,
    window: window ?? null,
    part,
    level: part === null ? "ok" : part >= FULL ? "full" : part >= WARN ? "warn" : "ok",
    cost: typeof usage?.cost === "number" ? usage.cost : null,
    provider: usage?.provider ?? null,
    estimated: exact === null && context !== null,
  };
}

/** Jetons par seconde. `null` tant que la mesure n'est pas significative :
    en dessous d'un cinquieme de seconde, le chiffre danse. */
export function rate(tokens: number, elapsedMs: number): number | null {
  if (elapsedMs < 200) return null;
  return Math.round((tokens / elapsedMs) * 1000);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".", ",")}k`;
  return String(Math.round(n));
}

/** Le prix, ou `null` s'il n'y a rien a dire : un « 0,00 $ » laisse croire
    que c'est gratuit. */
export function fmtCost(cost: number | null | undefined): string | null {
  if (typeof cost !== "number" || cost <= 0) return null;
  if (cost < 0.001) return "< 0,001 $";
  if (cost < 1) return `${cost.toFixed(3).replace(".", ",")} $`;
  return `${cost.toFixed(2).replace(".", ",")} $`;
}
