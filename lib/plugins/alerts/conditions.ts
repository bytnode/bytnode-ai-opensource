import { holds, parseUntil, type Condition as Until, type Sample } from "@/lib/tools/exchange/watch-until";

/* ---------------------------------------------------------------------------
   What an alert watches: ExchangeWatch's grammar (`price>=70000`,
   `pnl<-50`, `pnl%<-2`, `liq<3%`, `closed`), extended to

     change24h>5%     the change over 1h, 4h, 24h or 7d (BytNode)
     funding>0.05%    the funding rate, in % per 8 h
     event<24h        a notable calendar event for the asset within N hours

   A condition that cannot be evaluated (no price, no position readable)
   is an ERROR, never a silent false. Pure, tested.
--------------------------------------------------------------------------- */

type Op = "<" | "<=" | ">" | ">=";
export type Window = "1h" | "4h" | "24h" | "7d";

export type AlertCondition =
  | { kind: "until"; until: Until }
  | { kind: "change"; window: Window; op: Op; value: number }
  | { kind: "funding"; op: Op; value: number }
  | { kind: "event"; hours: number };

/** What was read for one asset at one evaluation. */
export type Reading = {
  price?: number;
  change?: Partial<Record<Window, number>>;
  funding?: number;
  position?: { open: boolean; pnl?: number; pnlPct?: number; liqPct?: number; mark?: number };
  /** Notable calendar events concerning the asset, in the widest window asked. */
  events?: Array<{ title: string; startsAt: string }>;
  /** Why a part could not be read. */
  errors?: { price?: string; funding?: string; position?: string; events?: string };
};

export const EXAMPLES = "`price>=70000`, `price<60000`, `change24h>5%`, `change1h<-3%`, `funding>0.05%`, `event<24h`, and on a futures position `pnl<-50`, `pnl%<-2`, `liq<3%`, `closed`";

const NUM = "(-?\\d+(?:\\.\\d+)?)";
const CHANGE = new RegExp(`^change\\s*(1h|4h|24h|7d)\\s*(<=|>=|<|>)\\s*${NUM}\\s*%?$`, "i");
const FUNDING = new RegExp(`^funding\\s*(<=|>=|<|>)\\s*${NUM}\\s*%?$`, "i");
const EVENT = /^event\s*<\s*(\d{1,3})\s*h$/i;
const MAX_EVENT_HOURS = 168;

export function parseCondition(text: string): AlertCondition | { error: string } {
  const t = text.trim();
  let m = CHANGE.exec(t);
  if (m) return { kind: "change", window: m[1].toLowerCase() as Window, op: m[2] as Op, value: Number(m[3]) };
  m = FUNDING.exec(t);
  if (m) return { kind: "funding", op: m[1] as Op, value: Number(m[2]) };
  m = EVENT.exec(t);
  if (m) {
    const hours = Number(m[1]);
    return hours >= 1 && hours <= MAX_EVENT_HOURS ? { kind: "event", hours } : { error: `An event window between 1 and ${MAX_EVENT_HOURS} hours.` };
  }
  const until = parseUntil(t);
  if ("error" in until) return { error: `Unreadable condition: "${t}". Expected: ${EXAMPLES}.` };
  return { kind: "until", until };
}

/** A condition on a futures position (read from an exchange account). */
export const onPosition = (c: AlertCondition): boolean => c.kind === "until" && c.until.field !== "price";

const compare = (a: number, op: Op, b: number) => (op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);
const fmt = (n: number) => Number(n.toPrecision(8)).toString();
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} %`;

export type Evaluation = { holds: boolean; observed: string } | { error: string };

/** The condition against what was read, at `now`. */
export function evaluate(c: AlertCondition, r: Reading, now: Date): Evaluation {
  switch (c.kind) {
    case "change": {
      const v = r.change?.[c.window];
      if (v === undefined) return { error: r.errors?.price ?? `No ${c.window} change available (BytNode gives it; an exchange ticker only has 24 h).` };
      return { holds: compare(v, c.op, c.value), observed: `${c.window} change ${pct(v)}` };
    }
    case "funding":
      if (r.funding === undefined) return { error: r.errors?.funding ?? "No funding rate available." };
      return { holds: compare(r.funding, c.op, c.value), observed: `funding ${fmt(r.funding)} % / 8 h` };
    case "event": {
      if (!r.events) return { error: r.errors?.events ?? "The calendar is off." };
      const limit = now.getTime() + c.hours * 3600_000;
      const next = r.events.find((e) => Date.parse(e.startsAt) >= now.getTime() && Date.parse(e.startsAt) <= limit);
      if (!next) return { holds: false, observed: `no notable event within ${c.hours} h` };
      const inHours = Math.max(0, Math.round((Date.parse(next.startsAt) - now.getTime()) / 3600_000));
      return { holds: true, observed: `${next.title} in ${inHours} h` };
    }
    case "until": {
      if (c.until.field === "price") {
        if (r.price === undefined) return { error: r.errors?.price ?? "No price available." };
        return { holds: holds(c.until, { price: r.price, open: false }), observed: `price ${fmt(r.price)}` };
      }
      if (!r.position) return { error: r.errors?.position ?? "The position could not be read." };
      const p = r.position;
      const sample: Sample = { price: p.mark ?? r.price ?? 0, open: p.open, pnl: p.pnl, pnlPct: p.pnlPct, liqPct: p.liqPct };
      const observed = !p.open
        ? "no open position"
        : [p.pnl !== undefined ? `PnL ${fmt(p.pnl)}` : "", p.pnlPct !== undefined ? `PnL ${pct(p.pnlPct)}` : "", p.liqPct !== undefined ? `liquidation at ${fmt(Math.abs(p.liqPct))} %` : ""].filter(Boolean).join(", ");
      /* A position that is not open satisfies only `closed`. */
      if (!p.open && c.until.field !== "closed") return { holds: false, observed };
      return { holds: holds(c.until, sample), observed };
    }
  }
}
