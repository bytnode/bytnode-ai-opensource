import { currentMessages } from "@/lib/i18n/store";
import type { Interval } from "../shared/candle";
import { parseCondition, type AlertCondition } from "./conditions";
import type { Metric } from "./metrics";

/* ---------------------------------------------------------------------------
   An alert's condition as the USER reads it, in the interface's language —
   the same sentence `describeCondition` / `metricLabel` write in English
   for the agent and for Telegram, which stay as they are. Read at call
   time, from a component that reads `useMessages()`. Pure.
--------------------------------------------------------------------------- */

const tf = (t: Interval) => t.replace("h", "H").replace("d", "D");

/** A metric as the user reads it: "RSI 14 · 1H", « Bollinger supérieure 20,2 · 1H ». */
export function metricWords(m: Metric): string {
  const w = currentMessages().alerts.words;
  switch (m.kind) {
    case "price":
      return w.price;
    case "funding":
      return w.funding;
    case "change":
      return w.change(m.window);
    case "rsi":
    case "ema":
    case "sma":
    case "atr":
      return `${m.kind.toUpperCase()} ${m.length} · ${tf(m.tf)}`;
    case "macd":
      return w.macd(w.macdLines[m.line], `${m.fast},${m.slow},${m.signal}`, tf(m.tf));
    case "bb":
      return w.bollinger(w.bands[m.band], `${m.length},${m.mult}`, tf(m.tf));
    case "stoch":
      return w.stochastic(`%${m.line.toUpperCase()}`, `${m.length},${m.smooth}`, tf(m.tf));
    case "volume":
      return w.volume(tf(m.tf));
  }
}

/** A condition as the user reads it: "RSI 14 · 1H crosses below 30". */
export function conditionWords(c: AlertCondition): string {
  const w = currentMessages().alerts.words;
  switch (c.kind) {
    case "change":
      return w.changeIs(c.window, w.signs[c.op], `${c.value >= 0 ? "+" : ""}${c.value}`);
    case "funding":
      return w.fundingIs(w.signs[c.op], String(c.value));
    case "event":
      return w.event(c.hours);
    case "compare": {
      const unit = c.left.kind === "change" || c.left.kind === "funding" ? " %" : "";
      const right = "value" in c.right ? `${c.right.value}${unit}` : metricWords(c.right.metric);
      return w.compare(metricWords(c.left), w.signs[c.op], right);
    }
    case "until": {
      const u = c.until;
      if (u.field === "closed") return w.closed;
      if (u.field === "price") return w.priceIs(w.signs[u.op], String(u.value));
      if (u.field === "liqPct") return w.liquidationIs(w.signs[u.op], String(u.value));
      return w.pnlIs(w.signs[u.op], `${u.value}${u.field === "pnlPct" ? " %" : ""}`);
    }
  }
}

/** A stored condition as the user reads it (the text itself if it no
    longer parses). */
export function alertWords(condition: string): string {
  const c = parseCondition(condition);
  return "error" in c ? condition : conditionWords(c);
}
