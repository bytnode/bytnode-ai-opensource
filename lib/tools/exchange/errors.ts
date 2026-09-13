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

export function describeExchangeError(e: unknown): string {
  const head = MESSAGES[nameOf(e)] ?? "L'exchange a répondu par une erreur.";
  return `${head} Exchange : ${textOf(e)}`;
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
