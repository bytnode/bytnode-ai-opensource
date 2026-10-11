"use client";

import { useCallback, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { byHour, sameDay } from "@/lib/plugins/calendar/days";
import { EventFacts } from "./event-facts";
import { locale, timeOf, toneOf } from "./format";
import { NewEntry } from "./new-entry";
import { useMessages } from "@/lib/i18n/react";

/* A day on a scale of hours, like Calendar's day view: the 24 hours as
   rounded tiles, each event in its hour as a tinted block that opens in
   place (an event without a time opens the day, in the first hour). On
   today, a red line says where the day stands. Pressing an hour — its
   label or the free part of its tile — opens the form of a new entry. */

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

type Props = {
  day: Date;
  events: CalendarEvent[];
  now: Date;
  /** The hour the view opens on (marked for the scroll), if any. */
  anchor?: number;
};

export function HourScale({ day, events, now, anchor }: Props) {
  const t = useMessages();
  const [opened, setOpened] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<number | null>(null);
  const closeDraft = useCallback(() => setDrafting(null), []);
  const hours = byHour(events);
  const today = sameDay(day, now);
  const toggle = (id: string) => setOpened(opened === id ? null : id);

  return (
    <div className="calv-hours">
      {hours.map((list, h) => (
        <div key={h} className="calv-hour" data-anchor={h === anchor || undefined}>
          <button type="button" className="calv-hour-label" onClick={() => setDrafting(h)} aria-label={t.calendar.newEventAt(hourLabel(h))}>
            {hourLabel(h)}
          </button>
          <div className={`calv-hour-slot${drafting === h ? " is-drafting" : ""}`} onClick={(e) => e.target === e.currentTarget && setDrafting(h)}>
            {list.map((e) => (
              <EventBlock key={e.id} event={e} open={opened === e.id} onToggle={() => toggle(e.id)} />
            ))}
            {drafting === h && <NewEntry day={day} hour={h} up={h >= 17} onClose={closeDraft} />}
            {today && now.getHours() === h && <i className="calv-now" role="img" style={{ top: `${(now.getMinutes() / 60) * 100}%` }} aria-label={t.calendar.nowAt(now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }))} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventBlock({ event, open, onToggle }: { event: CalendarEvent; open: boolean; onToggle: () => void }) {
  /* Its time is written in the interface's language: a change renders it again. */
  useMessages();
  return (
    <div className={`calv-block${open ? " is-open" : ""}${event.importance === 3 ? " is-strong" : ""}${event.done ? " is-done" : ""}`} style={toneOf(event.category)}>
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
