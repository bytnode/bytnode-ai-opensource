import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaPlan } from "@/lib/plugins/dca/plans";

/* The DCA tab's small writings: money, a result, a due date, a plan's
   badge. */

export const money = (n: number | undefined, unit: string) => (n === undefined ? "—" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`);

export const signedMoney = (n: number | undefined, unit: string) => (n === undefined ? "—" : `${n >= 0 ? "+" : "−"}${money(Math.abs(n), unit)}`);

export const pct = (n: number | undefined) => (n === undefined ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} %`);

export const toneOf = (n: number | undefined) => (n === undefined || Math.abs(n) < 0.005 ? "is-flat" : n > 0 ? "is-up" : "is-down");

export const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export type Badge = "PAPER" | "LIVE" | "TESTNET";

/** PAPER, or the badge of the account a real plan buys on (LIVE when the
    account is gone: never shown as less real than it may be). */
export const badgeOf = (plan: DcaPlan, accounts: ExchangeAccount[]): Badge => (plan.destination === "paper" ? "PAPER" : accounts.find((a) => a.id === plan.accountId)?.testnet ? "TESTNET" : "LIVE");

export const badgeClass = (b: Badge) => `xch-badge${b === "LIVE" ? " is-live" : b === "PAPER" ? " is-paper" : ""}`;
