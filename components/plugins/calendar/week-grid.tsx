"use client";

import { useCallback, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { byHour, dayKey, sameDay } from "@/lib/plugins/calendar/days";
import { useDismiss } from "@/components/ui/use-dismiss";
import { EventFacts } from "./event-facts";
import { LOCALE, timeOf, toneOf } from "./format";

/* This week as Calendar draws it: a column per day, the hours down the
   side, each event a tinted block in its day and its hour. The grid is
   made of rounded tiles parted by thin gaps — no line crosses another at
   a right angle. The days' heads sit right above the grid and outside
   its scroll, so they need no ground of their own: nothing is laid over
   the pane. Today's column is washed a little lighter and carries the red
   line of now. A day's head opens that day; a block opens its details in
   a bubble (towards the inside of the week, so it never leaves the pane). */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function WeekHead({ span, today, onPick }: { span: Date[]; today: Date; onPick: (day: Date) => void }) {
  return (
    <div className="calv-week-head">
      <div className="calv-week-row">
        <span className="calv-week-gutter" />
        {span.map((day) => (
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
    </div>
  );
}

type Props = {
  span: Date[];
  days: Map<string, CalendarEvent[]>;
  today: Date;
  now: Date;
  /** The hour the week opens on (marked for the scroll). */
  anchor: number;
};

export function WeekGrid({ span, days, today, now, anchor }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  const close = useCallback(() => setOpened(null), []);
  const cols = span.map((day) => ({ day, hours: byHour(days.get(dayKey(day)) ?? []) }));

  return (
    <div className="calv-week">
      {HOURS.map((h) => (
        <div key={h} className="calv-week-row" data-anchor={h === anchor || undefined}>
          <span className="calv-week-gutter">{hourLabel(h)}</span>
          {cols.map((c, i) => (
            <div key={c.day.getTime()} className={`calv-week-cell${sameDay(c.day, today) ? " is-today" : ""}`}>
              {c.hours[h].map((e) => (
                <WeekBlock key={e.id} event={e} open={opened === e.id} onToggle={() => setOpened(opened === e.id ? null : e.id)} onClose={close} flip={i >= 4} />
              ))}
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
    <div ref={root} className={`calv-wblock${event.importance === 3 ? " is-strong" : ""}${event.done ? " is-done" : ""}${open ? " is-open" : ""}`} style={toneOf(event.category)}>
      <button type="button" className="calv-wblock-main" onClick={onToggle} aria-expanded={open} title={event.title}>
        {!event.allDay && <span className="calv-wblock-time">{timeOf(event)}</span>}
        <span className="calv-wblock-title">{event.title}</span>
      </button>
      {open && (
        <div className={`calv-pop calv-event-pop${flip ? " is-flipped" : ""}`} role="dialog" aria-label={event.title}>
          <p className="calv-event-pop-title">{event.title}</p>
          <p className="calv-event-pop-when">{event.allDay ? when : `${when}, ${timeOf(event)}`}</p>
          <EventFacts event={event} />
        </div>
      )}
    </div>
  );
}
