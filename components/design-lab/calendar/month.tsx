"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { addDays, byDay, dayKey, LOCALE, monthGrid, sameDay, shortTitle, timeOf } from "./model";
import { EventCard, FilterMenu, Stepper, tone, useFilter } from "./parts";
import { useCalendarEvents, type Source } from "./use-events";

/* ---------------------------------------------------------------------------
   Version 1 — Month.

   The whole month at a glance, like Calendar on the Mac: hairline cells,
   the day number in the corner, today in red. A cell says only what
   happens (a coloured dot, a title, a time); the rest waits in the
   inspector, which follows the selected day.
--------------------------------------------------------------------------- */

const SHOWN = 3;

const weekdays = (from: Date) => Array.from({ length: 7 }, (_, i) => addDays(from, i).toLocaleDateString(LOCALE, { weekday: "short" }));

export function MonthView({ source, today }: { source: Source; today: Date }) {
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const filter = useFilter();
  const grid = monthGrid(month);
  const { events, loading, error } = useCalendarEvents(source, grid[0], 42, today);
  const days = byDay(filter.apply(events));
  const picked = days.get(dayKey(selected)) ?? [];

  const go = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const toToday = () => {
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(today);
  };

  return (
    <div className="cl-view">
      <header className="cl-bar">
        <h1 className="cl-title">
          {month.toLocaleDateString(LOCALE, { month: "long" })} <span className="cl-title-year">{month.getFullYear()}</span>
        </h1>
        {loading && <span className="cl-status">Loading…</span>}
        {error && <span className="cl-status is-error">{error}</span>}
        <span className="cl-spacer" />
        <FilterMenu filter={filter} />
        <Stepper unit="month" onPrev={() => go(-1)} onToday={toToday} onNext={() => go(1)} />
      </header>

      <div className="m-body">
        <div className="m-month">
          <div className="m-weekdays" aria-hidden>
            {weekdays(grid[0]).map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="m-grid" role="grid" aria-label={month.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}>
            {grid.map((d) => {
              const list = days.get(dayKey(d)) ?? [];
              const outside = d.getMonth() !== month.getMonth();
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selected);
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}, ${list.length} event${list.length === 1 ? "" : "s"}`}
                  className={`m-cell${outside ? " is-outside" : ""}${weekend ? " is-weekend" : ""}${isSelected ? " is-selected" : ""}`}
                  onClick={() => setSelected(d)}
                >
                  <span className={`m-num${isToday ? " is-today" : ""}`}>{d.getDate() === 1 ? d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" }) : d.getDate()}</span>
                  <span className="m-events">
                    {list.slice(0, SHOWN).map((e) => (
                      <Pill key={e.id} event={e} />
                    ))}
                    {list.length > SHOWN && <span className="m-more">{list.length - SHOWN} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="m-inspector" aria-label="Selected day">
          <p className="m-ins-weekday">{sameDay(selected, today) ? "Today" : selected.toLocaleDateString(LOCALE, { weekday: "long" })}</p>
          <p className="m-ins-date">{selected.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}</p>
          <div className="m-ins-list">
            {picked.length === 0 ? <p className="cl-empty">No events.</p> : picked.map((e) => <EventCard key={e.id} event={e} variant="compact" />)}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** One event in a month cell: all-day as a tinted capsule, timed as a dot,
    a title and a time. */
function Pill({ event }: { event: CalendarEvent }) {
  if (event.allDay) {
    return (
      <span className={`m-pill is-allday${event.importance === 3 ? " is-strong" : ""}`} style={tone(event)}>
        {shortTitle(event)}
      </span>
    );
  }
  return (
    <span className={`m-pill${event.importance === 3 ? " is-strong" : ""}`} style={tone(event)}>
      <span className="m-dot" aria-hidden />
      <span className="m-pill-title">{shortTitle(event)}</span>
      <span className="m-pill-time">{timeOf(event)}</span>
    </span>
  );
}
