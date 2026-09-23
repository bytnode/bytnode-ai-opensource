"use client";

import { useState } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { addDays, byDay, CATEGORY_TONE, DAY, dayKey, LOCALE, monthGrid, sameDay, timeOf } from "./model";
import { CalendarFilters, EventCard, Stepper, tone, useFilter } from "./parts";
import { useCalendarEvents, type Source } from "./use-events";

/* ---------------------------------------------------------------------------
   Version 3 — Up Next.

   The month and what is coming, side by side, like Calendar on the iPad:
   on the left the month — every day with its coloured marks — and the
   calendars as an ordered grid of filters under it; on the right the next
   three weeks from the chosen day, one section per day. A row says the
   time and the title; opening it shows the rest in place.
--------------------------------------------------------------------------- */

const AHEAD = 21;
const MARKS = 4;

export function AgendaView({ source, today }: { source: Source; today: Date }) {
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [opened, setOpened] = useState<string | null>(null);
  const filter = useFilter();
  const grid = monthGrid(month);
  /* One read covers the month on the left and the three weeks on the right. */
  const from = grid[0] < selected ? grid[0] : selected;
  const until = addDays(selected, AHEAD) > grid[41] ? addDays(selected, AHEAD) : grid[41];
  const { events, loading, error } = useCalendarEvents(source, from, Math.round((until.getTime() - from.getTime()) / DAY) + 1, today);
  const days = byDay(filter.apply(events));
  const counts: Partial<Record<Category, number>> = {};
  for (const e of events) counts[e.category] = (counts[e.category] ?? 0) + 1;
  const ahead = Array.from({ length: AHEAD }, (_, i) => addDays(selected, i)).filter((d, i) => i === 0 || days.has(dayKey(d)));

  const pick = (d: Date) => {
    setSelected(d);
    setOpened(null);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const label = (d: Date) => {
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, addDays(today, 1))) return "Tomorrow";
    return d.toLocaleDateString(LOCALE, { weekday: "long" });
  };

  return (
    <div className="cl-view a-view">
      <section className="a-cal" aria-label="Month">
        <header className="cl-bar a-cal-bar">
          <h1 className="cl-title">
            {month.toLocaleDateString(LOCALE, { month: "long" })} <span className="cl-title-year">{month.getFullYear()}</span>
          </h1>
          <span className="cl-spacer" />
          <Stepper
            unit="month"
            onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            onToday={() => pick(today)}
            onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          />
        </header>
        <div className="a-cal-weekdays" aria-hidden>
          {grid.slice(0, 7).map((d) => (
            <span key={d.getDay()}>{d.toLocaleDateString(LOCALE, { weekday: "short" })}</span>
          ))}
        </div>
        <div className="a-cal-grid" role="grid" aria-label={month.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}>
          {grid.map((d) => {
            const list = days.get(dayKey(d)) ?? [];
            return (
              <button
                key={d.getTime()}
                type="button"
                role="gridcell"
                aria-selected={sameDay(d, selected)}
                className={`a-cal-day${d.getMonth() !== month.getMonth() ? " is-outside" : ""}${sameDay(d, today) ? " is-today" : ""}${sameDay(d, selected) ? " is-selected" : ""}`}
                onClick={() => pick(d)}
                aria-label={`${d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}, ${list.length} event${list.length === 1 ? "" : "s"}`}
              >
                <span className="a-cal-num">{d.getDate()}</span>
                <span className="a-cal-marks" aria-hidden>
                  {list.slice(0, MARKS).map((e) => (
                    <i key={e.id} className={e.importance === 3 ? "is-strong" : undefined} style={{ background: CATEGORY_TONE[e.category] }} />
                  ))}
                  {list.length > MARKS && <b>+{list.length - MARKS}</b>}
                </span>
              </button>
            );
          })}
        </div>
        <CalendarFilters filter={filter} counts={counts} />
      </section>

      <main className="a-main">
        <header className="a-head">
          <h2 className="a-head-title">{label(selected)}</h2>
          <p className="a-head-date">{selected.toLocaleDateString(LOCALE, { weekday: sameDay(selected, today) ? "long" : undefined, day: "numeric", month: "long", year: "numeric" })}</p>
          {loading && <span className="cl-status">Loading…</span>}
          {error && <span className="cl-status is-error">{error}</span>}
        </header>
        <div className="a-list">
          {ahead.map((d, i) => {
            const list = days.get(dayKey(d)) ?? [];
            return (
              <section key={d.getTime()} className="a-day" aria-label={d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}>
                {i > 0 && (
                  <h3 className="a-day-title">
                    {label(d)} <span className="a-day-date">{d.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}</span>
                  </h3>
                )}
                {list.length === 0 ? (
                  <p className="cl-empty">Nothing scheduled.</p>
                ) : (
                  <ul className="a-rows">
                    {list.map((e) => (
                      <Row key={e.id} event={e} open={opened === e.id} onToggle={() => setOpened(opened === e.id ? null : e.id)} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <p className="cl-empty a-end">That is everything for the next three weeks.</p>
        </div>
      </main>
    </div>
  );
}

function Row({ event, open, onToggle }: { event: CalendarEvent; open: boolean; onToggle: () => void }) {
  return (
    <li className={`a-row${open ? " is-open" : ""}${event.importance === 3 ? " is-strong" : ""}`} style={tone(event)}>
      <button type="button" className="a-row-main" onClick={onToggle} aria-expanded={open}>
        <span className="a-row-time">{event.allDay ? "all-day" : timeOf(event)}</span>
        <span className="a-row-rule" aria-hidden />
        <span className="a-row-title">{event.title}</span>
        {event.assets.length > 0 && <span className="a-row-assets">{event.assets.join(", ")}</span>}
      </button>
      {open && (
        <div className="a-row-detail">
          <EventCard event={event} variant="facts" />
        </div>
      )}
    </li>
  );
}
