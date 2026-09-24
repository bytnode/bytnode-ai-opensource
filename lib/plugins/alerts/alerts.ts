import { normalizeSymbol } from "../shared/quote";
import { conditionText, describeCondition, onPosition, parseCondition, waitsForCrossing, type AlertCondition, type Evaluation } from "./conditions";

/* ---------------------------------------------------------------------------
   The alerts: what the user set, and when one fires.

   ONE TRIGGER PER CROSSING: an alert fires when its condition BECOMES true
   (right away if it already is when created — except `closed` and the
   `crosses_*` operators, which wait for a crossing after it is set), then
   not again until it has been false; and never twice within the cooldown.
   A one-shot alert is done after it fires; a paused one is not checked.
   The last value read is kept per asset, for the view. An evaluation that
   fails is recorded on the alert and said once, when it starts failing.
   Pure, tested.
--------------------------------------------------------------------------- */

export const WATCHLIST = "watchlist";

export type Alert = {
  id: string;
  /** A pair (`BTC/USDT`), or `watchlist`: every asset of the watchlist. */
  target: string;
  condition: string;
  once: boolean;
  note?: string;
  /** The exchange account of a position condition (its id). */
  accountId?: string;
  createdAt: string;
  status: "active" | "paused" | "done";
  /** Per asset: does the condition hold, when did it last fire, what was
      last read and when. */
  state: Record<string, { holds: boolean; firedAt?: string; observed?: string; checkedAt?: string }>;
  /** Why the last evaluation failed, per asset. */
  errors?: Record<string, string>;
};

export type Trigger = { id: string; alertId: string; symbol: string; at: string; condition: string; observed: string; note?: string };

/** An alert's condition as a person reads it (the stored text if it no
    longer parses). */
export function alertLabel(condition: string): string {
  const c = parseCondition(condition);
  return "error" in c ? condition : describeCondition(c);
}

export type AlertInput = { target?: unknown; condition?: unknown; once?: unknown; note?: unknown; accountId?: string };

/** A new alert, checked: the alert, or why not. */
export function newAlert(input: AlertInput, id: string, now: Date): { alert: Alert; condition: AlertCondition } | { error: string } {
  const raw = typeof input.target === "string" ? input.target.trim() : "";
  const target = raw.toLowerCase() === WATCHLIST ? WATCHLIST : normalizeSymbol(raw);
  if (!target) return { error: `Not a pair: "${raw}". Give a pair (BTC/USDT) or \`watchlist\`.` };
  const text = typeof input.condition === "string" ? input.condition.trim() : "";
  const condition = parseCondition(text);
  if ("error" in condition) return condition;
  if (onPosition(condition) && target === WATCHLIST) return { error: "A position condition is for one pair, not the whole watchlist." };
  if (onPosition(condition) && !input.accountId) return { error: "A position condition needs the exchange account that holds the position." };
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 200) : undefined;
  return {
    condition,
    alert: {
      id,
      target,
      condition: conditionText(condition, text),
      once: input.once !== false,
      ...(note ? { note } : {}),
      ...(onPosition(condition) ? { accountId: input.accountId } : {}),
      createdAt: now.toISOString(),
      status: "active",
      state: {},
    },
  };
}

export type Step = { alert: Alert; trigger?: Omit<Trigger, "id">; failing?: string };

/** One evaluation of an alert for one asset. */
export function step(alert: Alert, symbol: string, result: Evaluation, now: Date, cooldownMs: number): Step {
  if ("error" in result) {
    const already = alert.errors?.[symbol] === result.error;
    return { alert: { ...alert, errors: { ...alert.errors, [symbol]: result.error } }, ...(already ? {} : { failing: result.error }) };
  }
  const errors = { ...alert.errors };
  delete errors[symbol];
  const before = alert.state[symbol];
  /* `closed` starts as if closed: it fires on a close, not on an absence;
     a `crosses_*` as if already across: it fires on the next crossing. */
  const parsed = parseCondition(alert.condition);
  const held = before?.holds ?? (!("error" in parsed) && waitsForCrossing(parsed));
  const cooling = before?.firedAt !== undefined && now.getTime() - Date.parse(before.firedAt) < cooldownMs;
  const fire = alert.status === "active" && result.holds && !held && !cooling;
  const next: Alert = {
    ...alert,
    state: { ...alert.state, [symbol]: { holds: result.holds, ...(fire ? { firedAt: now.toISOString() } : before?.firedAt ? { firedAt: before.firedAt } : {}), observed: result.observed, checkedAt: now.toISOString() } },
    ...(fire && alert.once ? { status: "done" as const } : {}),
  };
  if (Object.keys(errors).length) next.errors = errors;
  else delete next.errors;
  return fire ? { alert: next, trigger: { alertId: alert.id, symbol, at: now.toISOString(), condition: alert.condition, observed: result.observed, ...(alert.note ? { note: alert.note } : {}) } } : { alert: next };
}

/** An alert in one line. */
export function alertLine(a: Alert): string {
  const target = a.target === WATCHLIST ? "every watchlist asset" : a.target;
  const fired = Object.entries(a.state)
    .filter(([, s]) => s.firedAt)
    .map(([symbol, s]) => `${a.target === WATCHLIST ? `${symbol} ` : ""}${s.firedAt!.slice(0, 16).replace("T", " ")} UTC`);
  const errors = Object.entries(a.errors ?? {}).map(([symbol, e]) => `${a.target === WATCHLIST ? `${symbol}: ` : ""}${e}`);
  return [
    `- [${a.id}] ${target}: ${a.condition} — ${a.once ? "once" : "recurring"}, ${a.status}`,
    fired.length ? `; fired ${fired.join(", ")}` : "",
    errors.length ? `; CANNOT EVALUATE: ${errors.join("; ")}` : "",
    a.note ? ` (${a.note})` : "",
  ].join("");
}
