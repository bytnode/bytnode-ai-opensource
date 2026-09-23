"use client";

import type { ToolCard } from "@/lib/tools/types";
import type { CardBadge, FactsCard, TableCard } from "@/lib/plugins/shared/cards";
import { viewEntry } from "@/lib/plugins/catalog";
import { openView } from "@/lib/state/tabs";
import { ArrowRight } from "@/components/ui/icons";
import "./plugins.css";

/* ---------------------------------------------------------------------------
   What a plugin shows in the thread, under its tool's row: a few figures,
   a small table — the answer at a glance, the raw output one click away —
   and, for OpenView, the way back to the tab it opened.
--------------------------------------------------------------------------- */

export function Badge({ badge }: { badge: CardBadge }) {
  return <span className={`xch-badge${badge === "LIVE" ? " is-live" : badge === "PAPER" ? " is-paper" : ""}`}>{badge}</span>;
}

function Facts({ card }: { card: FactsCard }) {
  return (
    <div className="pc">
      <p className="pc-title">
        {card.badge && <Badge badge={card.badge} />}
        {card.title}
      </p>
      <dl className="pc-facts">
        {card.rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className="mono">{r.value}</dd>
          </div>
        ))}
      </dl>
      {card.note && <p className="pc-note">{card.note}</p>}
    </div>
  );
}

function Table({ card }: { card: TableCard }) {
  return (
    <div className="pc">
      <p className="pc-title">
        {card.badge && <Badge badge={card.badge} />}
        {card.title}
      </p>
      <div className="pc-scroll">
        <table className="pc-table">
          <thead>
            <tr>
              {card.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className={j > 0 ? "mono" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.note && <p className="pc-note">{card.note}</p>}
    </div>
  );
}

export function ToolCardView({ card }: { card: ToolCard }) {
  if (card.kind === "facts") return <Facts card={card.data as FactsCard} />;
  if (card.kind === "table") return <Table card={card.data as TableCard} />;
  return null;
}

/** "Portfolio opened →": back to the tab the agent opened. */
export function OpenViewCard({ view, params }: { view: string; params?: Record<string, unknown> }) {
  const entry = viewEntry(view);
  if (!entry) return null;
  return (
    <button type="button" className="pc pc-link" onClick={() => openView(view, params)}>
      <span>
        {entry.title} opened
        <small>{entry.plugin.name}</small>
      </span>
      <ArrowRight />
    </button>
  );
}
