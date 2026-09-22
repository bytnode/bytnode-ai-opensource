/* ---------------------------------------------------------------------------
   ccxt errors, said in plain English.

   ccxt names its errors by their class (`error.name`); we do not import
   them here, to stay pure. The exchange's raw text always follows: it is
   what carries the code (-2019, insufficient margin…).
--------------------------------------------------------------------------- */

const MESSAGES: Record<string, string> = {
  InsufficientFunds: "Insufficient funds.",
  InvalidOrder: "Order refused by the exchange.",
  OrderNotFound: "Order not found (already filled or canceled?).",
  BadSymbol: "Unknown market on this exchange.",
  BadRequest: "Request refused by the exchange.",
  AuthenticationError: "API key refused: check the account in Authentication (Test button).",
  PermissionDenied: "The API key does not have this permission on the exchange.",
  AccountSuspended: "Account suspended by the exchange.",
  RateLimitExceeded: "Too many requests: the exchange asks to slow down.",
  DDoSProtection: "Too many requests: the exchange asks to slow down.",
  NetworkError: "The exchange is unreachable.",
  RequestTimeout: "The exchange did not answer in time.",
  ExchangeNotAvailable: "The exchange is unavailable (maintenance?).",
  NotSupported: "This operation is not supported by this exchange.",
};

const TRANSIENT = new Set(["RateLimitExceeded", "DDoSProtection", "NetworkError", "RequestTimeout", "ExchangeNotAvailable"]);

const nameOf = (e: unknown) => (e instanceof Error ? e.name : "");
const textOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isTransientExchangeError = (e: unknown) => TRANSIENT.has(nameOf(e));

/* A clock skew: the exchange refuses a request dated more than
   `recv_window` before its own time. It is neither the key nor the network
   — it is the PC's clock — and the raw text (10002, -1021) does not say so. */
const CLOCK = /recv_?window|timestamp for this request|server timestamp/i;
const STAMPS = /req_timestamp\[(\d+)\].*?server_timestamp\[(\d+)\]/;

function clockSkew(text: string): string | null {
  if (!CLOCK.test(text)) return null;
  const m = text.match(STAMPS);
  const gap = m ? Math.round(Math.abs(Number(m[2]) - Number(m[1])) / 1000) : null;
  return `This computer's clock is off${gap !== null ? ` by about ${gap} s` : ""} from the exchange's: synchronize the system time.`;
}

export function describeExchangeError(e: unknown): string {
  const text = textOf(e);
  const head = clockSkew(text) ?? MESSAGES[nameOf(e)] ?? "The exchange answered with an error.";
  return `${head} Exchange: ${text}`;
}

/** A second attempt, once only, on a transient error. */
export async function withRetry<T>(fn: () => Promise<T>, wait = 1000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransientExchangeError(e)) throw e;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  }
}
