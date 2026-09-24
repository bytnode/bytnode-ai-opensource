import type { Candle, Interval } from "../shared/candle";
import { INTERVAL_MS } from "../shared/candle";
import type { Book } from "./engine";

/* ---------------------------------------------------------------------------
   The paper portfolio's result over time, for the view's curve.

   The book keeps no snapshot: only its fills. So the curve is what the
   fills tell — the capital, plus what every CLOSED trade brought, minus
   every fee — bucket by bucket from the portfolio's first day; the last
   bucket closes on the equity marked to market when it is known (open
   positions and holdings at today's prices). It is walked BACK from the
   book's own totals, so fills trimmed from the book (it keeps the last
   1 000) never shift the curve: before the oldest kept fill it is flat.

   The bucket follows the span: 15 minutes for a portfolio of a few hours,
   an hour for a few days, a day beyond — at most `MAX_BUCKETS`, the most
   recent. Pure, tested.
--------------------------------------------------------------------------- */

export type Curve = { interval: Interval; candles: Candle[] };

const MAX_BUCKETS = 365;

export function intervalFor(spanMs: number): Interval {
  if (spanMs < 12 * 3_600_000) return "15m";
  if (spanMs < 3 * 86_400_000) return "1h";
  return "1d";
}

export function resultCurve(book: Book, now: Date, equity?: number): Curve {
  const start = Date.parse(book.createdAt);
  const end = now.getTime();
  const interval = intervalFor(Math.max(0, end - start));
  const step = INTERVAL_MS[interval];
  const first = Math.max(Math.floor(start / step) * step, Math.floor(end / step) * step - (MAX_BUCKETS - 1) * step);
  const last = Math.floor(end / step) * step;

  /* The realized value after each fill, walked back from today's. */
  const fills = [...book.fills].sort((a, b) => a.at.localeCompare(b.at));
  let value = book.capital + book.realizedPnl - book.fees;
  const after: Array<{ t: number; v: number }> = [];
  for (let i = fills.length - 1; i >= 0; i--) {
    after.push({ t: Date.parse(fills[i].at), v: value });
    value -= fills[i].realizedPnl - fills[i].fee;
  }
  after.reverse();
  const before = value;

  const candles: Candle[] = [];
  let i = 0;
  let current = before;
  for (let t = first; t <= last; t += step) {
    const open = current;
    let high = open;
    let low = open;
    while (i < after.length && after[i].t < t + step) {
      current = after[i].v;
      high = Math.max(high, current);
      low = Math.min(low, current);
      i += 1;
    }
    candles.push({ t, o: open, h: high, l: low, c: current, v: 0 });
  }
  const tail = candles[candles.length - 1];
  if (tail && equity !== undefined && Number.isFinite(equity)) {
    tail.c = equity;
    tail.h = Math.max(tail.h, equity);
    tail.l = Math.min(tail.l, equity);
  }
  return { interval, candles };
}
