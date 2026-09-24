import { exchangeInfo } from "@/lib/tools/exchange/catalog";
import type { Coverage } from "./backfill";

/* ---------------------------------------------------------------------------
   What an account's API key lets the portfolio read, and what it does not:
   the view says it above the curve — which boxes were not ticked, what the
   history therefore leaves out, and a link to the exchange's API key page.
   Bybit says what a key may do (`/v5/user/query-api`); another exchange
   is judged from its refusals ("the API key does not have this
   permission"). Read-only permissions only: the portfolio never asks for
   a withdrawal right. Pure, tested.
--------------------------------------------------------------------------- */

/** A permission the key lacks: the box to tick, and what is missing without it. */
export type Missing = { key: string; label: string; what: string };

export type Access = {
  exchange: string;
  missing: Missing[];
  /** What the history is made of, given the key. */
  shown: string;
  /** The exchange's API key page. */
  url?: string;
};

/** Bybit: the permission groups the whole account's history needs, as the
    key page names them. */
export const BYBIT_NEEDS: Array<{ group: string; permission: string } & Missing> = [
  { group: "Wallet", permission: "AccountTransfer", key: "wallet", label: "Assets → Wallet → Account Transfer", what: "the Funding wallet (where deposits land) and its transfers" },
  { group: "Earn", permission: "Earn", key: "earn", label: "Earn", what: "the Earn savings, their interest and the money that left them" },
  { group: "Exchange", permission: "ExchangeHistory", key: "exchange", label: "Assets → Exchange → Exchange History", what: "the conversions made in the Funding wallet" },
];

/** The Bybit permissions the key lacks, from `query-api`'s `permissions`
    (group → granted list). */
export function bybitMissing(permissions: Record<string, unknown> | null | undefined): Missing[] {
  if (!permissions) return [];
  return BYBIT_NEEDS.filter((n) => !(Array.isArray(permissions[n.group]) && (permissions[n.group] as unknown[]).includes(n.permission))).map(({ key, label, what }) => ({ key, label, what }));
}

const KIND_WHAT: Record<string, string> = {
  ledger: "the ledger (every change of a balance)",
  trades: "the trades",
  deposits: "the deposits",
  withdrawals: "the withdrawals",
  earn: "the Earn savings",
  converts: "the conversions",
};

/** Another exchange: every kind refused for want of a permission. */
export function missingFromCoverage(coverage: Record<string, Coverage> | undefined): Missing[] {
  return Object.entries(coverage ?? {})
    .filter(([, c]) => c.status === "error" && /permission/i.test(c.note ?? ""))
    .map(([kind]) => ({ key: kind, label: kind[0].toUpperCase() + kind.slice(1), what: KIND_WHAT[kind] ?? kind }));
}

/** The exchange's API key page, for the account's network. */
export function apiKeysUrl(exchange: string, testnet: boolean): string | undefined {
  const info = exchangeInfo(exchange);
  return (testnet ? info?.apiKeysTestnet : undefined) ?? info?.apiKeys;
}

/** What a Bybit history is made of, given what is missing. */
export function bybitShown(missing: Missing[]): string {
  const lacks = new Set(missing.map((m) => m.key));
  if (lacks.has("earn")) return lacks.has("wallet") ? "the Unified trading account only" : "the Unified trading account, and the Funding wallet at today's balance";
  return lacks.has("wallet") ? "the Unified trading account and Earn — the Funding wallet taken as empty" : "the whole account: Unified trading, Funding and Earn";
}
