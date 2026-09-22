import type { Step, UsageInfo } from "./events";

/* ---------------------------------------------------------------------------
   What a turn consumed, and where the context window stands.

   ⚠️ THIS INFORMATION WAS ALREADY ARRIVING, IT WAS BEING THROWN AWAY.
   OpenRouter puts the token count and the price in the last chunk of the
   stream; a subscription agent sends `usage_update`s with the context
   used, the size of its window and the cost. Without a display, the user
   knows neither what they spend, nor when to compact — they hit the wall.

   Pure: the formatting and the thresholds, tested. The thread uses it for
   the meter at the bottom right.
--------------------------------------------------------------------------- */

/** An order of magnitude, when the real count has not arrived yet:
    ~3.6 characters per token in French (a little less than in English). */
export const estimateTokens = (text: string) => Math.round(text.length / 3.6);

/** The last known count, field by field. `addCost` accumulates the price
    of successive turns instead of replacing it. */
export function mergeUsage(prev: UsageInfo | undefined, next: UsageInfo, opts: { addCost?: boolean } = {}): UsageInfo {
  const out: UsageInfo = { ...prev, ...next };
  if (opts.addCost && typeof prev?.cost === "number" && typeof next.cost === "number") out.cost = prev.cost + next.cost;
  return out;
}

/** The weight of the system prompt, the tool specifications and the skill
    list: what goes out at every turn BEFORE the messages. Measured on our
    tool set (~8,900 input tokens for an empty conversation); it is an
    order of magnitude, displayed with a `~`. */
export const PROMPT_OVERHEAD = 8_500;

/** The estimated context: what the thread weighs, plus the skeleton. Used
    as long as no exact count has arrived, and while a reply is being
    written. */
export function contextEstimate(messages: Array<{ content: string; steps?: Step[] }>, overhead = PROMPT_OVERHEAD): number {
  return overhead + messages.reduce((n, m) => n + estimateTokens(replayedText(m)), 0);
}

/** What goes back to the model from a message: its text, and its tools'
    outputs (replayed by `history.ts`) — not the reasoning nor the plan. */
function replayedText(m: { content: string; steps?: Step[] }): string {
  if (!m.steps?.length) return m.content;
  return m.steps.map((s) => (s.type === "tool" ? `${JSON.stringify(s.args)}${s.output ?? ""}` : s.type === "text" ? s.text : "")).join("");
}

export type UsageState = {
  /** Tokens used by the thread, as it will go out at the next turn. */
  context: number | null;
  window: number | null;
  /** Share of the window used, between 0 and 1. */
  part: number | null;
  level: "ok" | "warn" | "full";
  cost: number | null;
  provider: string | null;
  /** The displayed context is an estimate, not a count from the service. */
  estimated: boolean;
};

const WARN = 0.7;
const FULL = 0.9;

/** The meter's state. `windowFallback` comes from the catalog (the model's
    context length) when the agent does not announce it itself. */
export function usageState(usage: UsageInfo | undefined, windowFallback: number | null, estimate?: number | null): UsageState {
  const exact =
    typeof usage?.context === "number"
      ? usage.context
      : typeof usage?.input === "number"
        ? usage.input + (usage.output ?? 0)
        : null;
  const context = exact ?? (typeof estimate === "number" ? estimate : null);
  const window = typeof usage?.window === "number" ? usage.window : windowFallback;
  const part = context !== null && window ? context / window : null;
  return {
    context,
    window: window ?? null,
    part,
    level: part === null ? "ok" : part >= FULL ? "full" : part >= WARN ? "warn" : "ok",
    cost: typeof usage?.cost === "number" ? usage.cost : null,
    provider: usage?.provider ?? null,
    estimated: exact === null && context !== null,
  };
}

/** Tokens per second. `null` as long as the measure is not meaningful:
    under a fifth of a second, the figure jumps around. */
export function rate(tokens: number, elapsedMs: number): number | null {
  if (elapsedMs < 200) return null;
  return Math.round((tokens / elapsedMs) * 1000);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** The price, or `null` if there is nothing to say: a « $0.00 » suggests
    it is free. */
export function fmtCost(cost: number | null | undefined): string | null {
  if (typeof cost !== "number" || cost <= 0) return null;
  if (cost < 0.001) return "< $0.001";
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
