import type { ExchangeAccount } from "@/lib/domain/types";
import type { CardBadge } from "../shared/cards";
import { summarize, type DcaPlan, type Purchase } from "./plans";

/* A plan and its purchases in words, for the tools. Pure, tested. */

const num = (n: number) => Number(n.toPrecision(8)).toString();
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** PAPER, or the badge of the account a real plan buys on. */
export const badgeOf = (plan: DcaPlan, accounts: ExchangeAccount[]): CardBadge => {
  if (plan.destination === "paper") return "PAPER";
  return accounts.find((a) => a.id === plan.accountId)?.testnet ? "TESTNET" : "LIVE";
};

export function planLine(plan: DcaPlan, purchases: Purchase[], accounts: ExchangeAccount[]): string {
  const quote = plan.symbol.split("/")[1];
  const where = plan.destination === "paper" ? "paper portfolio" : `${accounts.find((a) => a.id === plan.accountId)?.label ?? "a removed account"} (${badgeOf(plan, accounts)}, each purchase confirmed)`;
  const s = summarize(purchases.filter((p) => p.planId === plan.id));
  const bought = s.purchases ? `; ${s.purchases} purchase(s): ${num(s.invested)} ${quote} for ${num(s.amount)} ${plan.symbol.split("/")[0]}, average ${num(s.average!)}` : "; nothing bought yet";
  const next = plan.status === "active" && plan.nextDue ? `next ${when(plan.nextDue)}` : plan.status;
  return `- [${plan.id}] ${num(plan.quoteAmount)} ${quote} of ${plan.symbol}, ${plan.frequency}, into the ${where} — ${next}${bought}${s.pending ? `; ${s.pending} awaiting your confirmation` : ""}${plan.note ? ` (${plan.note})` : ""}`;
}

export function purchaseLine(p: Purchase): string {
  const what = p.amount !== undefined && p.price !== undefined ? `${num(p.amount)} at ${num(p.price)}` : "";
  const status: Record<Purchase["status"], string> = { filled: "bought", proposed: "awaiting confirmation", refused: "refused by you", expired: "not confirmed in time", failed: "failed", skipped: "skipped" };
  return `${when(p.due)} [${p.mode}] ${status[p.status]}${what ? ` ${what}` : ""}${p.late ? " (missed while the app was closed)" : ""}${p.detail && p.status !== "filled" ? ` — ${p.detail}` : ""}`;
}
