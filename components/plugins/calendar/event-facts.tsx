"use client";

import { useState, type ReactNode } from "react";
import { USER, type CalendarEvent } from "@/lib/plugins/calendar/events";
import { useMessages } from "@/lib/i18n/react";
import type { Messages } from "@/lib/i18n/messages/en";
import { openView } from "@/lib/state/tabs";
import { useCalendarActions } from "./actions";

/* What an agenda row leaves out, shown when it opens: the calendar, the
   assets, the impact, the notes, where the entry comes from — and what can
   be done with it. An entry an agent wrote can be deleted (a second click
   confirms); a scheduled run is managed in the Scheduled tasks tab; a
   computed expiry is neither. */

function sourceOf(m: Messages, e: CalendarEvent, agent: string | null): ReactNode {
  if (e.category === "scheduled") return e.source;
  if (e.computed) return m.calendar.facts.computed;
  if (e.by === USER && !e.url) return m.calendar.facts.addedByYou;
  if (e.category === "task" && !e.url) return m.calendar.facts.addedBy(agent ?? e.source);
  if (!e.url) return e.source;
  return (
    <a href={e.url} target="_blank" rel="noreferrer">
      {e.source}
    </a>
  );
}

export function EventFacts({ event }: { event: CalendarEvent }) {
  const t = useMessages();
  const w = t.calendar.facts;
  const { remove, agentName } = useCalendarActions();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const agent = agentName(event.by);

  return (
    <>
      <dl className="calv-facts">
        <div>
          <dt>{w.calendar}</dt>
          <dd>
            <span className="calv-swatch" aria-hidden />
            {t.calendar.categories[event.category]}
            {event.done && w.done}
          </dd>
        </div>
        {event.assets.length > 0 && (
          <div>
            <dt>{w.assets}</dt>
            <dd>{event.assets.join(", ")}</dd>
          </div>
        )}
        {event.importance === 3 && event.category !== "task" && (
          <div>
            <dt>{w.impact}</dt>
            <dd>{w.marketMoving}</dd>
          </div>
        )}
        {event.notes && (
          <div>
            <dt>{w.notes}</dt>
            <dd className="calv-notes">{event.notes}</dd>
          </div>
        )}
        <div>
          <dt>{w.source}</dt>
          <dd>{sourceOf(t, event, agent)}</dd>
        </div>
        {agent && event.category !== "task" && (
          <div>
            <dt>{w.addedByLabel}</dt>
            <dd>{agent}</dd>
          </div>
        )}
      </dl>
      {event.category === "scheduled" ? (
        <div className="calv-facts-actions">
          <button type="button" className="calv-fact-btn" onClick={() => openView("scheduler")}>
            {w.openScheduler}
          </button>
        </div>
      ) : (
        !event.computed && (
          <div className="calv-facts-actions">
            <button
              type="button"
              className={`calv-fact-btn is-danger${confirm ? " is-armed" : ""}`}
              disabled={busy}
              onBlur={() => setConfirm(false)}
              onClick={async () => {
                if (!confirm) return setConfirm(true);
                setBusy(true);
                await remove(event.id);
                setBusy(false);
                setConfirm(false);
              }}
            >
              {confirm ? w.deleteConfirm : t.common.delete}
            </button>
          </div>
        )
      )}
    </>
  );
}
