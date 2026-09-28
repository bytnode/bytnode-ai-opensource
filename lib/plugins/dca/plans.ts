import { nextRun, parseFrequency, type Frequency } from "../core/frequency";
import { normalizeSymbol } from "../shared/quote";

/* ---------------------------------------------------------------------------
   Recurring purchases: the plans, their due dates, their history.

   A plan buys a fixed amount of quote currency of one asset at every due
   date, into the paper portfolio or on an exchange account. On an
   exchange, a due date only PROPOSES the order: the user confirms it
   (`ctx.confirm`), always. A due date missed while the app was closed is
   not made up several times: the next check handles the latest one, and
   in real money it is proposed, never run. Pure, tested.
--------------------------------------------------------------------------- */

export type Destination = "paper" | "exchange";

export type DcaPlan = {
  id: string;
  symbol: string;
  /** In the pair's quote currency. */
  quoteAmount: number;
  frequency: string;
  destination: Destination;
  /** The exchange account (its id) of a real plan. */
  accountId?: string;
  startAt: string;
  endAt?: string;
  note?: string;
  /** What the user calls it ("BTC every Monday"); absent: its pair. */
  name?: string;
  /** Its group (`groups.ts`): every DCA belongs to one. */
  groupId?: string;
  status: "active" | "paused" | "ended";
  createdAt: string;
  /** The next due date; absent when the plan has ended. */
  nextDue?: string;
};

export type Purchase = {
  id: string;
  planId: string;
  /** The due date it answers. */
  due: string;
  at: string;
  mode: "paper" | "live" | "testnet";
  status: "filled" | "proposed" | "refused" | "expired" | "failed" | "skipped";
  /** Base quantity and average price, when known (a fill). */
  amount?: number;
  price?: number;
  fee?: number;
  confirmationId?: string;
  /** What went wrong, or what the exchange said. */
  detail?: string;
  /** Made up for a due date missed while the app was closed. */
  late?: boolean;
};

const MIN_INTERVAL_MINUTES = 60;
/** A due date older than this when checked was missed (app closed). */
export const GRACE_MS = 10 * 60_000;

export type PlanInput = { symbol?: unknown; quoteAmount?: unknown; frequency?: unknown; destination?: unknown; accountId?: string; startAt?: unknown; endAt?: unknown; note?: unknown; name?: unknown; groupId?: string };

/** The first due date from `start` on: an interval starts at once, a time
    of day at its first occurrence. */
export const firstDue = (f: Frequency, start: number) => (f.kind === "interval" ? start : nextRun(f, start - 1));

const MAX_NAME = 60;
/** Above this, an amount is a typo (the paper portfolios' own ceiling). */
export const MAX_QUOTE_AMOUNT = 10_000_000;
const AMOUNT_TOO_BIG = `The amount each time is at most ${MAX_QUOTE_AMOUNT.toLocaleString("en-US")}.`;
const cleanName = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, MAX_NAME) : undefined);

export function newPlan(input: PlanInput, id: string, now: Date): DcaPlan | { error: string } {
  const symbol = typeof input.symbol === "string" ? normalizeSymbol(input.symbol) : null;
  if (!symbol) return { error: "Give the asset to buy, as a pair (BTC/USDT)." };
  const quoteAmount = typeof input.quoteAmount === "number" ? input.quoteAmount : NaN;
  if (!(quoteAmount > 0)) return { error: "Give the amount to spend at each purchase (`quoteAmount`), in the pair's quote currency." };
  if (quoteAmount > MAX_QUOTE_AMOUNT) return { error: AMOUNT_TOO_BIG };
  const frequency = typeof input.frequency === "string" ? input.frequency.trim() : "";
  const f = parseFrequency(frequency);
  if ("error" in f) return { error: f.error };
  if (f.kind === "interval" && f.minutes < MIN_INTERVAL_MINUTES) return { error: "A recurring purchase happens at most every hour." };
  const destination: Destination | null = input.destination === "exchange" ? "exchange" : input.destination === "paper" ? "paper" : null;
  if (!destination) return { error: "Choose where to buy: `paper` (simulated) or `exchange` (real, each purchase confirmed by the user)." };
  if (destination === "exchange" && !input.accountId) return { error: "A real plan needs the exchange account to buy on." };
  const start = typeof input.startAt === "string" && input.startAt ? Date.parse(input.startAt) : now.getTime();
  if (!Number.isFinite(start)) return { error: `Not a date: ${String(input.startAt)}.` };
  const end = typeof input.endAt === "string" && input.endAt ? Date.parse(input.endAt) : undefined;
  if (end !== undefined && !(end > start)) return { error: "The end must come after the start." };
  const due = firstDue(f, Math.max(start, now.getTime()));
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 200) : undefined;
  const name = cleanName(input.name);
  return {
    id,
    symbol,
    quoteAmount,
    frequency,
    destination,
    ...(destination === "exchange" ? { accountId: input.accountId } : {}),
    startAt: new Date(start).toISOString(),
    ...(end !== undefined ? { endAt: new Date(end).toISOString() } : {}),
    ...(note ? { note } : {}),
    ...(name ? { name } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    status: end !== undefined && due > end ? "ended" : "active",
    createdAt: now.toISOString(),
    ...(end === undefined || due <= end ? { nextDue: new Date(due).toISOString() } : {}),
  };
}

/** The due date to handle now, if any; `late`: missed while the app was
    closed. */
export function dueNow(plan: DcaPlan, now: Date): { due: string; late: boolean } | null {
  if (plan.status !== "active" || !plan.nextDue) return null;
  const due = Date.parse(plan.nextDue);
  if (due > now.getTime()) return null;
  return { due: plan.nextDue, late: now.getTime() - due > GRACE_MS };
}

/** The plan once a due date is handled: the next one strictly after now
    (missed ones are not made up), or ended. */
export function advance(plan: DcaPlan, now: Date): DcaPlan {
  const f = parseFrequency(plan.frequency);
  if ("error" in f) return { ...plan, status: "paused" };
  let next = nextRun(f, Date.parse(plan.nextDue ?? plan.startAt));
  while (next <= now.getTime()) next = nextRun(f, next);
  if (plan.endAt && next > Date.parse(plan.endAt)) {
    const ended: DcaPlan = { ...plan, status: "ended" };
    delete ended.nextDue;
    return ended;
  }
  return { ...plan, nextDue: new Date(next).toISOString() };
}

export type PlanAction = "pause" | "resume" | "delete";

/** Pauses, resumes (from the next due date after now) or deletes a plan. */
export function changePlan(plans: DcaPlan[], id: string, action: PlanAction, now: Date): { plans: DcaPlan[]; plan: DcaPlan } | { error: string } {
  const plan = plans.find((p) => p.id === id.trim());
  if (!plan) return { error: `No DCA plan "${id}". DcaList shows them.` };
  if (action === "delete") return { plans: plans.filter((p) => p !== plan), plan };
  if (plan.status === "ended") return { error: `The plan ${plan.id} has ended.` };
  const changed: DcaPlan = action === "pause" ? { ...plan, status: "paused" } : plan.status === "paused" ? advance({ ...plan, status: "active" }, now) : plan;
  return { plans: plans.map((p) => (p === plan ? changed : p)), plan: changed };
}

export type PlanEdit = { quoteAmount?: unknown; frequency?: unknown; endAt?: unknown; name?: unknown; note?: unknown };

/** A DCA's settings changed: its amount, its frequency (the next due date
    counted again from now), its end (`null` or "" removes it; an end
    already passed ends it, a later one brings an ended DCA back), its name
    and its note. Where it buys never changes: that is a new DCA. */
export function editPlan(plans: DcaPlan[], id: string, patch: PlanEdit, now: Date): { plans: DcaPlan[]; plan: DcaPlan } | { error: string } {
  const found = plans.find((p) => p.id === id);
  if (!found) return { error: `No DCA plan "${id}".` };
  const plan: DcaPlan = { ...found };
  if (patch.quoteAmount !== undefined) {
    if (!(typeof patch.quoteAmount === "number" && patch.quoteAmount > 0)) return { error: "The amount each time must be above zero." };
    if (patch.quoteAmount > MAX_QUOTE_AMOUNT) return { error: AMOUNT_TOO_BIG };
    plan.quoteAmount = patch.quoteAmount;
  }
  let f = parseFrequency(plan.frequency);
  let rescheduled = false;
  if (patch.frequency !== undefined && patch.frequency !== plan.frequency) {
    const text = typeof patch.frequency === "string" ? patch.frequency.trim() : "";
    const g = parseFrequency(text);
    if ("error" in g) return { error: g.error };
    if (g.kind === "interval" && g.minutes < MIN_INTERVAL_MINUTES) return { error: "A recurring purchase happens at most every hour." };
    plan.frequency = text;
    f = g;
    rescheduled = true;
  }
  if (patch.endAt !== undefined) {
    if (patch.endAt === null || patch.endAt === "") delete plan.endAt;
    else {
      const end = typeof patch.endAt === "string" ? Date.parse(patch.endAt) : NaN;
      if (!Number.isFinite(end)) return { error: `Not a date: ${String(patch.endAt)}.` };
      /* Checked as at creation: a typo in the year used to end the plan
         for good, with no way back. Clearing the end is how to go on. */
      if (!(end > (Date.parse(plan.startAt) || 0))) return { error: "The end must come after the start." };
      if (!(end > now.getTime())) return { error: "The end must be in the future (clear it to keep the plan running)." };
      plan.endAt = new Date(end).toISOString();
    }
  }
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (name) plan.name = name;
    else delete plan.name;
  }
  if (patch.note !== undefined) {
    const note = typeof patch.note === "string" && patch.note.trim() ? patch.note.trim().slice(0, 200) : undefined;
    if (note) plan.note = note;
    else delete plan.note;
  }
  if ("error" in f) return { error: f.error };
  /* The next due date, when the schedule or the end moved. */
  if (plan.status !== "paused" && (rescheduled || patch.endAt !== undefined)) {
    const next = rescheduled || plan.status === "ended" || !plan.nextDue ? firstDue(f, Math.max(Date.parse(plan.startAt) || 0, now.getTime())) : Date.parse(plan.nextDue);
    if (plan.endAt && next > Date.parse(plan.endAt)) {
      plan.status = "ended";
      delete plan.nextDue;
    } else {
      plan.status = "active";
      plan.nextDue = new Date(next).toISOString();
    }
  } else if (rescheduled && plan.status === "paused") plan.nextDue = new Date(firstDue(f, now.getTime())).toISOString();
  return { plans: plans.map((p) => (p.id === id ? plan : p)), plan };
}

export type PlanSummary = { purchases: number; invested: number; amount: number; average?: number; pending: number };

/** What a plan bought: exact on the fills whose quantity and price are
    known (fees apart). */
export function summarize(purchases: Purchase[]): PlanSummary {
  const filled = purchases.filter((p) => p.status === "filled" && p.amount !== undefined && p.price !== undefined);
  const amount = filled.reduce((t, p) => t + p.amount!, 0);
  const invested = filled.reduce((t, p) => t + p.amount! * p.price!, 0);
  return { purchases: filled.length, invested, amount, ...(amount > 0 ? { average: invested / amount } : {}), pending: purchases.filter((p) => p.status === "proposed").length };
}

/** The fill of a confirmed PlaceOrder, from its output
    (`… · average 65000 · filled 0.0015`). */
export function readOrderOutcome(output: string): { amount?: number; price?: number } {
  const num = (re: RegExp) => {
    const m = re.exec(output);
    return m ? Number(m[1]) : undefined;
  };
  const amount = num(/filled (\d+(?:\.\d+)?(?:e-?\d+)?)/);
  const price = num(/average (\d+(?:\.\d+)?(?:e-?\d+)?)/);
  return { ...(amount !== undefined && amount > 0 ? { amount } : {}), ...(price !== undefined && price > 0 ? { price } : {}) };
}
