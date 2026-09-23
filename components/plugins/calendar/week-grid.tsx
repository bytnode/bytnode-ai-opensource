"use client";

import { useCallback, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { byHour, dayKey, sameDay } from "@/lib/plugins/calendar/days";
import { useDismiss } from "@/components/ui/use-dismiss";
import { EventFacts } from "./event-facts";
import { LOCALE, timeOf, toneOf } from "./format";

/* This week as Calendar draws it: a column per day, the hours down the
   side, each event a tinted block in its day and its hour — the events of
   a whole day under the day's date. The days' heads stay on top while the
   hours scroll, on the pane's own ground (one ground, nothing laid over
   it); today's column is washed a little lighter and carries the red line
   of now. A day's head opens that day; a block opens its details in a
   bubble (towards the inside of the week, so it never leaves the pane). */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

type Props = {
  span: Date[];
  days: Map<string, CalendarEvent[]>;
  today: Date;
  now: Date;
  /** The hour the week opens on (marked for the scroll). */
  anchor: number;
  onPick: (day: Date) => void;
};

export function WeekGrid({ span, days, today, now, anchor, onPick }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  const close = useCallback(() => setOpened(null), []);
  const cols = span.map((day) => ({ day, ...byHour(days.get(dayKey(day)) ?? []) }));
  const allDay = cols.some((c) => c.allDay.length > 0);
  const cell = (day: Date) => `calv-week-cell${sameDay(day, today) ? " is-today" : ""}`;
  const block = (e: CalendarEvent, i: number) => <WeekBlock key={e.id} event={e} open={opened === e.id} onToggle={() => setOpened(opened === e.id ? null : e.id)} onClose={close} flip={i >= 4} />;

  return (
    <div className="calv-week">
      <div className="calv-week-head" data-pinned>
        <div className="calv-week-row">
          <span className="calv-week-gutter" />
          {cols.map(({ day }) => (
            <button
              key={day.getTime()}
              type="button"
              className={`calv-week-day${sameDay(day, today) ? " is-today" : ""}${day < today ? " is-past" : ""}`}
              onClick={() => onPick(day)}
              aria-label={`Open ${day.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}`}
            >
              <span className="calv-week-dow">{day.toLocaleDateString(LOCALE, { weekday: "short" })}</span>
              <span className="calv-week-num">{day.getDate()}</span>
            </button>
          ))}
        </div>
        {allDay && (
          <div className="calv-week-row">
            <span className="calv-week-gutter" />
            {cols.map((c, i) => (
              <div key={c.day.getTime()} className="calv-week-top">
                {c.allDay.map((e) => block(e, i))}
              </div>
            ))}
          </div>
        )}
      </div>
      {HOURS.map((h) => (
        <div key={h} className="calv-week-row" data-anchor={h === anchor || undefined}>
          <span className="calv-week-gutter">{hourLabel(h)}</span>
          {cols.map((c, i) => (
            <div key={c.day.getTime()} className={cell(c.day)}>
              {c.hours[h].map((e) => block(e, i))}
              {sameDay(c.day, now) && now.getHours() === h && (
                <i className="calv-now" role="img" style={{ top: `${(now.getMinutes() / 60) * 100}%` }} aria-label={`Now, ${now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type BlockProps = { event: CalendarEvent; open: boolean; onToggle: () => void; onClose: () => void; flip: boolean };

function WeekBlock({ event, open, onToggle, onClose, flip }: BlockProps) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose, root);
  const when = new Date(event.startsAt).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: event.allDay ? "UTC" : undefined });

  return (
    <div ref={root} className={`calv-wblock${event.importance === 3 ? " is-strong" : ""}${open ? " is-open" : ""}`} style={toneOf(event.category)}>
      <button type="button" className="calv-wblock-main" onClick={onToggle} aria-expanded={open} title={event.title}>
        {!event.allDay && <span className="calv-wblock-time">{timeOf(event)}</span>}
        <span className="calv-wblock-title">{event.title}</span>
      </button>
      {open && (
        <div className={`calv-pop calv-event-pop${flip ? " is-flipped" : ""}`} role="dialog" aria-label={event.title}>
          <p className="calv-event-pop-title">{event.title}</p>
          <p className="calv-event-pop-when">
            {event.allDay ? when : `${when}, ${timeOf(event)}`}
          </p>
          <EventFacts event={event} />
        </div>
      )}
    </div>
  );
}
