/* ---------------------------------------------------------------------------
   Le filet de la boucle : reprendre ce qui doit l'etre, couper ce qui tourne
   en rond.

   Deux pannes distinctes, deux traitements.

   ⚠️ UNE ERREUR TRANSITOIRE N'EST PAS UNE ERREUR. Un 429, un 502, une
   connexion coupee : la requete n'a rien produit, la relancer est sans
   risque — et c'est tout ce qui separe un tour perdu d'un tour qui
   aboutit. Une erreur de requete (cle invalide, modele inconnu, credit
   epuise), elle, se reproduira a l'identique : la relancer ne fait que
   retarder le message d'erreur.

   ⚠️ UN AGENT PEUT TOURNER EN ROND. Le meme outil, les memes arguments, le
   meme echec, quarante fois — ca coute de l'argent et du temps, et ca
   n'aboutit jamais. Au troisieme appel identique, on refuse et on le dit a
   l'agent, qui doit changer de voie.

   Pur : pas de reseau, pas de temps reel — teste.
--------------------------------------------------------------------------- */

/** Les statuts qui valent une relance : surcharge, indisponibilite, delai. */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524, 529]);

/** Les coupures reseau, telles que les runtimes les nomment. */
const TRANSIENT_TEXT =
  /failed to fetch|network|socket hang up|econnreset|econnrefused|etimedout|epipe|enotfound|terminated|stream closed|fetch failed|other side closed/i;

export function isTransient(error: unknown): boolean {
  /* Une interruption voulue (bouton Arrêter) n'est jamais relancee. */
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (typeof error === "object" && error !== null) {
    const e = error as { name?: unknown; status?: unknown; message?: unknown };
    if (e.name === "AbortError") return false;
    if (typeof e.status === "number" && TRANSIENT_STATUS.has(e.status)) return true;
    if (typeof e.status === "number") return false;
    if (typeof e.message === "string" && TRANSIENT_TEXT.test(e.message)) return true;
  }
  return false;
}

export const MAX_ATTEMPTS = 3;

/** Attente avant la relance : croissante, bornee, avec un peu de hasard
    pour ne pas repartir tous en meme temps. */
export const MAX_BACKOFF = 8000;

export function backoffDelay(attempt: number): number {
  const base = Math.min(MAX_BACKOFF, 600 * 2 ** attempt);
  /* La borne s'applique APRES le hasard : sinon un tirage haut la depasse. */
  return Math.min(MAX_BACKOFF, Math.round(base * (0.75 + Math.random() * 0.5)));
}

/* --- Tourner en rond ----------------------------------------------------- */

export type CallLike = { name: string; args: Record<string, unknown> };

/** La signature d'un appel : le nom et les arguments, independamment de
    l'ordre des cles. */
export function callSignature(call: CallLike): string {
  const args = Object.keys(call.args ?? {})
    .sort()
    .map((k) => `${k}=${JSON.stringify(call.args[k])}`)
    .join("&");
  return `${call.name}|${args}`;
}

export const MAX_IDENTICAL = 3;

export class RepetitionGuard {
  private counts = new Map<string, number>();

  /** Rend `null` si l'appel peut partir, ou le message a renvoyer a l'agent
      a la place du resultat. */
  check(call: CallLike): string | null {
    const sig = callSignature(call);
    const n = (this.counts.get(sig) ?? 0) + 1;
    this.counts.set(sig, n);
    if (n < MAX_IDENTICAL) return null;
    const resume = summarize(call);
    return (
      `Tu viens de demander ${MAX_IDENTICAL} fois exactement le même appel : ${call.name}${resume ? ` — ${resume}` : ""}. ` +
      `Il ne donnera pas un autre résultat. Change d'approche : lis l'erreur précédente, vérifie tes arguments, ` +
      `essaie un autre outil, ou explique à l'utilisateur ce qui bloque et ce dont tu as besoin.`
    );
  }

  /** Un appel qui a abouti : son compteur repart de zero (une commande peut
      legitimement etre relancee plus tard). */
  succeeded(call: CallLike): void {
    this.counts.delete(callSignature(call));
  }
}

/** De quoi reconnaitre l'appel dans le message, sans le recopier en entier. */
function summarize(call: CallLike): string {
  const a = call.args ?? {};
  for (const k of ["command", "file_path", "pattern", "url", "data", "strategy", "name"]) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  return "";
}
