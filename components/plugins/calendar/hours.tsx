"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { byHour, sameDay } from "@/lib/plugins/calendar/days";
import { EventFacts } from "./event-facts";
import { LOCALE, timeOf, toneOf } from "./format";

/* A day on a scale of hours, like Calendar's day view: the 24 hours,
   each timed event in its hour as a tinted block that opens in place (the
   events of the whole day sit in the agenda's header, above the scale).
   On today, a red line says where the day stands. */

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

type Props = {
  day: Date;
  events: CalendarEvent[];
  now: Date;
  /** The hour the view opens on (marked for the scroll), if any. */
  anchor?: number;
};

export function HourScale({ day, events, now, anchor }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  const { hours } = byHour(events);
  const today = sameDay(day, now);
  const toggle = (id: string) => setOpened(opened === id ? null : id);

  return (
    <div className="calv-hours">
      {hours.map((list, h) => (
        <div key={h} className="calv-hour" data-anchor={h === anchor || undefined}>
          <span className="calv-hour-label">{hourLabel(h)}</span>
          <div className="calv-hour-slot">
            {list.map((e) => (
              <EventBlock key={e.id} event={e} open={opened === e.id} onToggle={() => toggle(e.id)} />
            ))}
            {today && now.getHours() === h && <i className="calv-now" role="img" style={{ top: `${(now.getMinutes() / 60) * 100}%` }} aria-label={`Now, ${now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`} />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventBlock({ event, open, onToggle }: { event: CalendarEvent; open: boolean; onToggle: () => void }) {
  return (
    <div className={`calv-block${open ? " is-open" : ""}${event.importance === 3 ? " is-strong" : ""}`} style={toneOf(event.category)}>
      <button type="button" className="calv-block-main" onClick={onToggle} aria-expanded={open}>
        {!event.allDay && <span className="calv-block-time">{timeOf(event)}</span>}
        <span className="calv-block-title">{event.title}</span>
        {event.assets.length > 0 && <span className="calv-block-assets">{event.assets.join(", ")}</span>}
      </button>
      {open && (
        <div className="calv-block-detail">
          <EventFacts event={event} />
        </div>
      )}
    </div>
  );
}
