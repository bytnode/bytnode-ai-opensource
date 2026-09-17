import type { ExchangeAccount } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   Les comptes d'exchange, vus des outils.

   Ils arrivent du navigateur (en-tete `x-exchange-accounts`, ou corps de
   la requete ACP, ou env du serveur MCP), deja filtres : ce sont ceux que
   L'AGENT a le droit de piloter. Ici on les lit sans confiance, on en
   choisit un par son label, et on les decrit pour le prompt. Pur.
--------------------------------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Ne garde que les comptes complets : id, exchange, label. */
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

/** L'en-tete a envoyer : du JSON encode en URI, parce qu'un en-tete HTTP
    n'accepte que du Latin-1 et qu'un label peut porter « € » ou un emoji. */
export const encodeAccountsHeader = (accounts: ExchangeAccount[]): string => encodeURIComponent(JSON.stringify(accounts));

/** L'en-tete tel qu'il arrive : JSON encode (ou brut, pour l'env du
    serveur MCP), ou rien. */
export function parseAccountsHeader(raw: string | null | undefined): ExchangeAccount[] {
  if (!raw) return [];
  for (const text of [raw, safeDecode(raw)]) {
    try {
      return parseAccounts(JSON.parse(text));
    } catch {
      /* forme suivante */
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

/** Les comptes qu'un agent peut piloter, dans l'ordre des reglages. */
export const allowedAccounts = (all: ExchangeAccount[], ids: string[] | undefined): ExchangeAccount[] =>
  ids?.length ? all.filter((a) => ids.includes(a.id)) : [];

const labels = (accounts: ExchangeAccount[]) => accounts.map((a) => a.label).join(", ");

/** Le compte vise par un appel : implicite s'il n'y en a qu'un, sinon par
    label (sans la casse) ou par id. */
export function pickAccount(accounts: ExchangeAccount[], name: string | undefined): { account: ExchangeAccount } | { error: string } {
  if (accounts.length === 0) return { error: "Aucun compte exchange n'est rattaché à cet agent." };
  if (!name?.trim()) {
    if (accounts.length === 1) return { account: accounts[0] };
    return { error: `Plusieurs comptes : précise \`account\` parmi ${labels(accounts)}.` };
  }
  const wanted = name.trim().toLowerCase();
  const found = accounts.find((a) => a.label.toLowerCase() === wanted || a.id === name.trim());
  return found ? { account: found } : { error: `Compte inconnu : « ${name.trim()} ». Comptes disponibles : ${labels(accounts)}.` };
}

/** Pour le prompt : « Binance-main (binance, RÉEL), Bybit-test (bybit, testnet) ». */
export const describeAccounts = (accounts: ExchangeAccount[]): string =>
  accounts.map((a) => `${a.label} (${a.exchange}, ${a.testnet ? "testnet" : "RÉEL"})`).join(", ");

/** Le secret tel que ccxt l'attend. Une cle CDP Coinbase est une cle
    privee EC en PEM : collee depuis le JSON, elle arrive avec des `\\n`
    litteraux ; collee dans un champ d'une ligne, aplatie. On rend un PEM
    propre (en-tete, corps replie a 64 colonnes, pied) ; tout autre secret
    est rendu tel quel. Pur. */
export function pemSecret(secret: string): string {
  if (!secret.includes("-----BEGIN")) return secret;
  const unescaped = secret.replace(/\\n/g, "\n").trim();
  const m = unescaped.match(/^(-----BEGIN [A-Z ]+-----)\s*([\s\S]*?)\s*(-----END [A-Z ]+-----)$/);
  if (!m) return unescaped;
  const body = m[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `${m[1]}\n${lines.join("\n")}\n${m[3]}\n`;
}

/** Un compte au moins engage de l'argent reel ? */
export const anyLive = (accounts: ExchangeAccount[]): boolean => accounts.some((a) => !a.testnet);
