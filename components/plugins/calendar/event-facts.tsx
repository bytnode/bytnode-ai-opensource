import type { ReactNode } from "react";
import { CATEGORY_LABELS, type CalendarEvent } from "@/lib/plugins/calendar/events";

/* What an agenda row leaves out, shown when it opens: the calendar, the
   assets, the impact, and where the event comes from. */

function sourceOf(e: CalendarEvent): ReactNode {
  if (e.computed) return "Computed from the venue's schedule";
  if (!e.url) return e.source;
  return (
    <a href={e.url} target="_blank" rel="noreferrer">
      {e.source}
    </a>
  );
}

export function EventFacts({ event }: { event: CalendarEvent }) {
  return (
    <dl className="calv-facts">
      <div>
        <dt>Calendar</dt>
        <dd>
          <span className="calv-swatch" aria-hidden />
          {CATEGORY_LABELS[event.category]}
        </dd>
      </div>
      {event.assets.length > 0 && (
        <div>
          <dt>Assets</dt>
          <dd>{event.assets.join(", ")}</dd>
        </div>
      )}
      {event.importance === 3 && (
        <div>
          <dt>Impact</dt>
          <dd>Market-moving</dd>
        </div>
      )}
      <div>
        <dt>Source</dt>
        <dd>{sourceOf(event)}</dd>
      </div>
    </dl>
  );
}
