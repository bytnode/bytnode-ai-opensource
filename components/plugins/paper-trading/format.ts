import type { Fill, PaperOrder, Valuation } from "@/lib/plugins/paper-trading/engine";
import type { Curve } from "@/lib/plugins/paper-trading/curve";
import type { Stats } from "@/lib/plugins/paper-trading/stats";
import { fmt } from "../bits";

/* The Paper trading tab's words and figures, shared by its two columns. */

/** A portfolio in the left column: the plugin's `books` action. */
export type BookRow = { id: string; name: string; createdAt: string; capital: number; equity?: number; returnPct?: number; positions: number; orders: number };

/** What the plugin's `state` action answers: one portfolio. */
export type PaperState = {
  id: string;
  name: string;
  valuation: Valuation;
  capital: number;
  createdAt: string;
  orders: PaperOrder[];
  fills: Fill[];
  available: Record<string, number>;
  prices: Record<string, number>;
  curve: Curve;
  stats: Stats;
  at: string;
  priceErrors: string[];
  feePercent: number;
  slippagePercent: number;
};

export const CASH = "USDT";

/** A sum in USDT, grouped, two decimals. */
export const usdt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? "—" : fmt(n, 2));

/** A signed sum: "+12.40", "−3.10". */
export const signed = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), 2)}`);

/** A price, with the decimals its size calls for: 64,210.50, 146.90, 0.1012. */
export const price = (n: number | undefined): string => {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  return a >= 100 ? fmt(n, 2) : a >= 1 ? fmt(Number(n.toFixed(4))) : fmt(Number(n.toPrecision(4)));
};

export const pct = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} %`);

/** The move's class: Apple's green or red, or nothing. */
export const toneOf = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) || Math.abs(n) < 1e-9 ? "is-flat" : n > 0 ? "is-up" : "is-down");

export const dayOf = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const whenOf = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return today ? `Today ${time}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
};

export const baseOf = (symbol: string): string => symbol.split("/")[0] ?? symbol;

/** An order in a few words: "Buy 0.01 BTC", "Short 0.5 ETH ×5". */
export function orderTitle(o: Pick<PaperOrder, "side" | "amount" | "symbol" | "market" | "leverage" | "reduceOnly">): string {
  const verb = o.market === "futures" ? (o.reduceOnly ? "Reduce" : o.side === "buy" ? "Long" : "Short") : o.side === "buy" ? "Buy" : "Sell";
  return `${verb} ${fmt(o.amount)} ${baseOf(o.symbol)}${o.market === "futures" && !o.reduceOnly ? ` ×${o.leverage ?? 1}` : ""}`;
}

/** A fill as a line of the activity: "Bought 0.01 BTC". */
export function fillTitle(f: Fill): string {
  if (f.liquidation) return `Liquidated ${fmt(f.amount)} ${baseOf(f.symbol)}`;
  if (f.market === "futures") return `${f.side === "buy" ? "Bought" : "Sold"} ${fmt(f.amount)} ${baseOf(f.symbol)} futures`;
  return `${f.side === "buy" ? "Bought" : "Sold"} ${fmt(f.amount)} ${baseOf(f.symbol)}`;
}
