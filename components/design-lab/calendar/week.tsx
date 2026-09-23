"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { addDays, byDay, dayKey, LOCALE, minutesOf, sameDay, shortTitle, startOfWeek, timeOf } from "./model";
import { EventCard, FilterMenu, Stepper, tone, useFilter } from "./parts";
import { useCalendarEvents, type Source } from "./use-events";

/* ---------------------------------------------------------------------------
   Version 2 — Week.

   Time made visible, like Calendar's week view: seven columns over the
   hours of the day, each event placed at its hour, the red line of now
   running through today. All-day events (unlocks, listings, expiries)
   sit in their own lane above. A click opens the event's card beside it.
--------------------------------------------------------------------------- */

const HOUR = 60;
/** Events have no end: each is drawn as a 55-minute block. */
const SPAN = 55;
const FIRST_HOUR = 7;

type Placed = { event: CalendarEvent; col: number; cols: number };

/** Side by side when blocks overlap, each cluster sharing its width. */
function layoutDay(events: CalendarEvent[]): Placed[] {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => minutesOf(a) - minutesOf(b));
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let ends: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const p of cluster) p.cols = ends.length;
    out.push(...cluster);
    cluster = [];
    ends = [];
  };
  for (const e of timed) {
    const start = minutesOf(e);
    if (start >= clusterEnd) close();
    let col = ends.findIndex((end) => end <= start);
    if (col < 0) col = ends.length;
    ends[col] = start + SPAN;
    clusterEnd = Math.max(clusterEnd, start + SPAN);
    cluster.push({ event: e, col, cols: 1 });
  }
  close();
  return out;
}

type Open = { event: CalendarEvent; top: number; left: number };

export function WeekView({ source, today }: { source: Source; today: Date }) {
  const [start, setStart] = useState(() => startOfWeek(today));
  const [open, setOpen] = useState<Open | null>(null);
  const [now, setNow] = useState(() => new Date());
  const filter = useFilter();
  const { events, loading, error } = useCalendarEvents(source, start, 7, today);
  const days = byDay(filter.apply(events));
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const scroller = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = FIRST_HOUR * HOUR - 12;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  const go = (weeks: number) => {
    setStart(addDays(start, weeks * 7));
    setOpen(null);
  };
  const title = () => {
    const end = week[6];
    const sameMonth = start.getMonth() === end.getMonth();
    const a = start.toLocaleDateString(LOCALE, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
    const b = end.toLocaleDateString(LOCALE, { day: "numeric", month: sameMonth ? "long" : "short" });
    return { range: `${a} – ${b}`, year: end.getFullYear() };
  };
  const show = (event: CalendarEvent, e: ReactMouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frame = view.current!.getBoundingClientRect();
    const width = 300;
    const right = box.right - frame.left + 10;
    const left = right + width > frame.width - 12 ? box.left - frame.left - width - 10 : right;
    setOpen({ event, top: Math.min(Math.max(box.top - frame.top - 8, 64), frame.height - 260), left });
  };
  const t = title();

  return (
    <div className="cl-view" ref={view}>
      <header className="cl-bar">
        <h1 className="cl-title">
          {t.range} <span className="cl-title-year">{t.year}</span>
        </h1>
        {loading && <span className="cl-status">Loading…</span>}
        {error && <span className="cl-status is-error">{error}</span>}
        <span className="cl-spacer" />
        <FilterMenu filter={filter} />
        <Stepper
          unit="week"
          onPrev={() => go(-1)}
          onToday={() => {
            setStart(startOfWeek(today));
            setOpen(null);
          }}
          onNext={() => go(1)}
        />
      </header>

      <div className="w-head">
        <span className="w-gutter" />
        {week.map((d) => (
          <div key={d.getTime()} className={`w-day${sameDay(d, today) ? " is-today" : ""}`}>
            <span className="w-weekday">{d.toLocaleDateString(LOCALE, { weekday: "short" })}</span>
            <span className="w-date">{d.getDate()}</span>
          </div>
        ))}
      </div>

      <div className="w-allday">
        <span className="w-gutter w-gutter-label">all-day</span>
        {week.map((d) => (
          <div key={d.getTime()} className="w-allday-cell">
            {(days.get(dayKey(d)) ?? [])
              .filter((e) => e.allDay)
              .map((e) => (
                <button key={e.id} type="button" className={`w-capsule${e.importance === 3 ? " is-strong" : ""}`} style={tone(e)} onClick={(ev) => show(e, ev)}>
                  {shortTitle(e)}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="w-scroll" ref={scroller} onScroll={() => open && setOpen(null)}>
        <div className="w-grid" style={{ height: 24 * HOUR }}>
          <div className="w-hours" aria-hidden>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h === 0 ? "" : new Date(2000, 0, 1, h).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}
              </span>
            ))}
          </div>
          {week.map((d) => {
            const isToday = sameDay(d, today);
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={d.getTime()} className={`w-col${weekend ? " is-weekend" : ""}`}>
                {layoutDay(days.get(dayKey(d)) ?? []).map(({ event, col, cols }) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`w-block${event.importance === 3 ? " is-strong" : ""}${open?.event.id === event.id ? " is-open" : ""}`}
                    style={{ ...tone(event), top: (minutesOf(event) / 60) * HOUR + 1, height: (SPAN / 60) * HOUR - 3, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                    onClick={(ev) => show(event, ev)}
                  >
                    <span className="w-block-time">{timeOf(event)}</span>
                    <span className="w-block-title">{shortTitle(event)}</span>
                  </button>
                ))}
                {isToday && (
                  <span className="w-now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }} aria-label={`Now, ${now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <>
          <button type="button" className="w-scrim" aria-label="Close the event" onClick={() => setOpen(null)} />
          <div className="cl-pop w-popover" style={{ top: open.top, left: open.left }} role="dialog" aria-label={open.event.title}>
            <EventCard event={open.event} />
          </div>
        </>
      )}
    </div>
  );
}
