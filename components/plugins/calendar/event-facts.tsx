"use client";

import { useState, type ReactNode } from "react";
import { CATEGORY_LABELS, type CalendarEvent } from "@/lib/plugins/calendar/events";
import { openView } from "@/lib/state/tabs";
import { useCalendarActions } from "./actions";

/* What an agenda row leaves out, shown when it opens: the calendar, the
   assets, the impact, the notes, where the entry comes from — and what can
   be done with it. An entry an agent wrote can be deleted (a second click
   confirms); a scheduled run is managed in the Scheduled tasks tab; a
   computed expiry is neither. */

function sourceOf(e: CalendarEvent, agent: string | null): ReactNode {
  if (e.category === "scheduled") return e.source;
  if (e.computed) return "Computed from the venue's schedule";
  if (e.category === "task" && !e.url) return `Added by ${agent ?? e.source}`;
  if (!e.url) return e.source;
  return (
    <a href={e.url} target="_blank" rel="noreferrer">
      {e.source}
    </a>
  );
}

export function EventFacts({ event }: { event: CalendarEvent }) {
  const { remove, agentName } = useCalendarActions();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const agent = agentName(event.by);

  return (
    <>
      <dl className="calv-facts">
        <div>
          <dt>Calendar</dt>
          <dd>
            <span className="calv-swatch" aria-hidden />
            {CATEGORY_LABELS[event.category]}
            {event.done && " · done"}
          </dd>
        </div>
        {event.assets.length > 0 && (
          <div>
            <dt>Assets</dt>
            <dd>{event.assets.join(", ")}</dd>
          </div>
        )}
        {event.importance === 3 && event.category !== "task" && (
          <div>
            <dt>Impact</dt>
            <dd>Market-moving</dd>
          </div>
        )}
        {event.notes && (
          <div>
            <dt>Notes</dt>
            <dd className="calv-notes">{event.notes}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>{sourceOf(event, agent)}</dd>
        </div>
        {agent && event.category !== "task" && (
          <div>
            <dt>Added by</dt>
            <dd>{agent}</dd>
          </div>
        )}
      </dl>
      {event.category === "scheduled" ? (
        <div className="calv-facts-actions">
          <button type="button" className="calv-fact-btn" onClick={() => openView("scheduler")}>
            Open Scheduled tasks
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
              {confirm ? "Delete — click again" : "Delete"}
            </button>
          </div>
        )
      )}
    </>
  );
}
