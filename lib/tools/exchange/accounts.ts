import type { ExchangeAccount } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   Exchange accounts, as the tools see them.

   They come from the browser (`x-exchange-accounts` header, or the ACP
   request body, or the MCP server's env), already filtered: they are the
   ones THE AGENT is allowed to drive. Here we read them without trust,
   pick one by its label, and describe them for the prompt. Pure.
--------------------------------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Keeps only complete accounts: id, exchange, label. */
export function parseAccounts(value: unknown): ExchangeAccount[] {
  if (!Array.isArray(value)) return [];
  const out: ExchangeAccount[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const exchange = str(raw.exchange);
    const label = str(raw.label);
    if (!id || !exchange || !label) continue;
    out.push({ id, exchange, label, apiKey: str(raw.apiKey), secret: str(raw.secret), password: str(raw.password), testnet: raw.testnet === true });
  }
  return out;
}

/** The header to send: URI-encoded JSON, because an HTTP header only
    accepts Latin-1 and a label may carry "€" or an emoji. */
export const encodeAccountsHeader = (accounts: ExchangeAccount[]): string => encodeURIComponent(JSON.stringify(accounts));

/** The header as it arrives: encoded JSON (or raw, for the MCP server's
    env), or nothing. */
export function parseAccountsHeader(raw: string | null | undefined): ExchangeAccount[] {
  if (!raw) return [];
  for (const text of [raw, safeDecode(raw)]) {
    try {
      return parseAccounts(JSON.parse(text));
    } catch {
      /* next form */
    }
  }
  return [];
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The accounts an agent may drive, in settings order. */
export const allowedAccounts = (all: ExchangeAccount[], ids: string[] | undefined): ExchangeAccount[] =>
  ids?.length ? all.filter((a) => ids.includes(a.id)) : [];

const labels = (accounts: ExchangeAccount[]) => accounts.map((a) => a.label).join(", ");

/** The account a call targets: implicit if there is only one, otherwise by
    label (case-insensitive) or by id. */
export function pickAccount(accounts: ExchangeAccount[], name: string | undefined): { account: ExchangeAccount } | { error: string } {
  if (accounts.length === 0) return { error: "No exchange account is attached to this agent." };
  if (!name?.trim()) {
    if (accounts.length === 1) return { account: accounts[0] };
    return { error: `Several accounts: specify \`account\` among ${labels(accounts)}.` };
  }
  const wanted = name.trim().toLowerCase();
  const found = accounts.find((a) => a.label.toLowerCase() === wanted || a.id === name.trim());
  return found ? { account: found } : { error: `Unknown account: "${name.trim()}". Available accounts: ${labels(accounts)}.` };
}

/** For the prompt: "Binance-main (binance, LIVE), Bybit-test (bybit, testnet)". */
export const describeAccounts = (accounts: ExchangeAccount[]): string =>
  accounts.map((a) => `${a.label} (${a.exchange}, ${a.testnet ? "testnet" : "LIVE"})`).join(", ");

/** The secret as ccxt expects it. A Coinbase CDP key is an EC private key
    in PEM: pasted from the JSON, it arrives with literal `\\n`; pasted into
    a single-line field, flattened. We return a clean PEM (header, body
    wrapped at 64 columns, footer); any other secret is returned as is.
    Pure. */
export function pemSecret(secret: string): string {
  if (!secret.includes("-----BEGIN")) return secret;
  const unescaped = secret.replace(/\\n/g, "\n").trim();
  const m = unescaped.match(/^(-----BEGIN [A-Z ]+-----)\s*([\s\S]*?)\s*(-----END [A-Z ]+-----)$/);
  if (!m) return unescaped;
  const body = m[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `${m[1]}\n${lines.join("\n")}\n${m[3]}\n`;
}

/** Does at least one account put real money at stake? */
export const anyLive = (accounts: ExchangeAccount[]): boolean => accounts.some((a) => !a.testnet);
