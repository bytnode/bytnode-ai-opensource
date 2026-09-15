/* ---------------------------------------------------------------------------
   Les erreurs de ccxt, dites en français.

   ccxt nomme ses erreurs par leur classe (`error.name`) ; on ne les
   importe pas ici, pour rester pur. Le texte brut de l'exchange suit
   toujours : c'est lui qui dit le code (-2019, marge insuffisante…).
--------------------------------------------------------------------------- */

const MESSAGES: Record<string, string> = {
  InsufficientFunds: "Fonds insuffisants.",
  InvalidOrder: "Ordre refusé par l'exchange.",
  OrderNotFound: "Ordre introuvable (déjà exécuté ou annulé ?).",
  BadSymbol: "Marché inconnu sur cet exchange.",
  BadRequest: "Requête refusée par l'exchange.",
  AuthenticationError: "Clé API refusée : vérifiez le compte dans Authentification (bouton Tester).",
  PermissionDenied: "La clé API n'a pas ce droit sur l'exchange.",
  AccountSuspended: "Compte suspendu par l'exchange.",
  RateLimitExceeded: "Trop de requêtes : l'exchange demande de ralentir.",
  DDoSProtection: "Trop de requêtes : l'exchange demande de ralentir.",
  NetworkError: "L'exchange est injoignable.",
  RequestTimeout: "L'exchange n'a pas répondu à temps.",
  ExchangeNotAvailable: "L'exchange est indisponible (maintenance ?).",
  NotSupported: "Cette opération n'est pas prise en charge par cet exchange.",
};

const TRANSIENT = new Set(["RateLimitExceeded", "DDoSProtection", "NetworkError", "RequestTimeout", "ExchangeNotAvailable"]);

const nameOf = (e: unknown) => (e instanceof Error ? e.name : "");
const textOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isTransientExchangeError = (e: unknown) => TRANSIENT.has(nameOf(e));

/* Un decalage d'horloge : l'exchange refuse une requete datee de plus de
   `recv_window` avant son heure a lui. Ce n'est ni la cle ni le reseau —
   c'est l'heure du PC — et le texte brut (10002, -1021) ne le dit pas. */
const CLOCK = /recv_?window|timestamp for this request|server timestamp/i;
const STAMPS = /req_timestamp\[(\d+)\].*?server_timestamp\[(\d+)\]/;

function clockSkew(text: string): string | null {
  if (!CLOCK.test(text)) return null;
  const m = text.match(STAMPS);
  const gap = m ? Math.round(Math.abs(Number(m[2]) - Number(m[1])) / 1000) : null;
  return `L'horloge de cet ordinateur est décalée${gap !== null ? ` d'environ ${gap} s` : ""} par rapport à l'exchange : synchronisez l'heure du système.`;
}

export function describeExchangeError(e: unknown): string {
  const text = textOf(e);
  const head = clockSkew(text) ?? MESSAGES[nameOf(e)] ?? "L'exchange a répondu par une erreur.";
  return `${head} Exchange : ${text}`;
}

/** Un second essai, une seule fois, sur une erreur passagere. */
export async function withRetry<T>(fn: () => Promise<T>, wait = 1000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransientExchangeError(e)) throw e;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  }
}
