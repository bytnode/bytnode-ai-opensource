"use client";

import { fmtCost, fmtTokens, usageState } from "@/lib/agent/usage";
import type { UsageInfo } from "@/lib/agent/events";
import { numberTag } from "@/lib/i18n/store";
import { useMessages } from "@/lib/i18n/react";

type Props = {
  usage: UsageInfo | undefined;
  /** The current turn's rate, in tokens per second. */
  rate: number | null;
  /** The model's window, when the agent does not announce it itself. */
  window: number | null;
  /** The estimated context, used as long as no exact count has arrived
      and while a reply is being written. */
  estimate?: number | null;
  streaming: boolean;
};

/* ---------------------------------------------------------------------------
   The meter, bottom right of the thread.

   One line, three pieces of information in this order of need: where the
   context window stands (it is what decides when to compact), how fast the
   model answers, and what it costs. It stays discreet as long as everything
   is fine, and turns amber then red as the window fills up.
--------------------------------------------------------------------------- */
export function UsageMeter({
  usage,
  rate,
  window,
  estimate,
  streaming,
}: Props) {
  const m = useMessages();
  /* While a reply is being written, the previous turn's count is stale:
     the live estimate takes over. */
  const s = usageState(streaming ? undefined : usage, window, estimate);
  const cost = fmtCost(usage?.cost ?? null);
  if (s.context === null && rate === null && !cost) return null;

  const pct = s.part === null ? null : Math.min(100, Math.round(s.part * 100));
  const num = (n: number) => n.toLocaleString(numberTag());
  const titre = [
    s.context !== null
      ? m.chat.usage.context(s.estimated, num(s.context), s.window ? num(s.window) : null)
      : null,
    typeof usage?.input === "number"
      ? m.chat.usage.input(num(usage.input))
      : null,
    typeof usage?.output === "number"
      ? m.chat.usage.output(num(usage.output))
      : null,
    cost ? m.chat.usage.cost(cost) : null,
    s.provider ? m.chat.usage.provider(s.provider) : null,
    s.level !== "ok"
      ? m.chat.usage.filling
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className={`usage usage-${s.level}${streaming ? " is-live" : ""}`}
      title={titre}
      aria-live="off"
    >
      {s.context !== null && (
        <span className="usage-ctx">
          {pct !== null && (
            <span className="usage-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
          {s.estimated ? "~" : ""}
          {fmtTokens(s.context)}
          {s.window ? ` / ${fmtTokens(s.window)}` : ""}
          {pct !== null ? ` · ${pct}%` : ""}
        </span>
      )}
      {rate !== null && <span className="usage-rate">{rate} tok/s</span>}
      {cost && <span className="usage-cost">{cost}</span>}
    </div>
  );
}
