import type { WatchItem } from "@/lib/plugins/watchlist/list";
import type { Quote } from "@/lib/plugins/shared/quote";

/* How the Watchlist tab writes things: a pair split into its two assets,
   a move with a true minus, a source by its name, a time of day. */

export type Row = WatchItem & { quote: Quote | null; error: string | null };

export const LOCALE = "en-GB";

/** `BTC/USDT` → `["BTC", "USDT"]` (a futures suffix dropped). */
export function pairOf(symbol: string): [string, string] {
  const [base, quote = ""] = symbol.replace(/:.*$/, "").split("/");
  return [base, quote];
}

/** A change in %, signed: `+1.24 %`, `−0.87 %`, `—` when unknown. */
export function pct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} %`;
}

/** `rise`, `fall` or `flat`: the class of a move. */
export const moveOf = (v: number | undefined): "is-up" | "is-down" | "is-flat" => (v === undefined || v === 0 ? "is-flat" : v > 0 ? "is-up" : "is-down");

export const sourceName = (s: string): string => (s === "bytnode" ? "BytNode" : s.charAt(0).toUpperCase() + s.slice(1));

export const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

export const dateOf = (iso: string): string => new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
