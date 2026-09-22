/* Symbols in ccxt format: `BTC/USDT` on spot, `BTC/USDT:USDT` for a linear
   perpetual. The model often writes `BTCUSDT` or in lowercase; we repair
   what can be repaired. Pure. */

export type Market = "spot" | "futures";

const QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "USD", "EUR", "BTC", "ETH", "BNB"];

export function toSymbol(raw: string, market: Market): string {
  let s = raw.trim().toUpperCase();
  if (!s.includes("/")) {
    const quote = QUOTES.find((q) => s.endsWith(q) && s.length > q.length);
    if (quote) s = `${s.slice(0, -quote.length)}/${quote}`;
  }
  const [pair, settle] = s.split(":");
  if (market === "spot") return pair;
  if (settle) return s;
  const quote = pair.split("/")[1];
  return quote ? `${pair}:${quote}` : pair;
}
