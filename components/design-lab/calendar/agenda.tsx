"use client";

import { useState } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { addDays, byDay, CATEGORY_TONE, DAY, dayKey, LOCALE, monthGrid, sameDay, timeOf } from "./model";
import { CalendarList, EventCard, tone, useFilter } from "./parts";
import { useCalendarEvents, type Source } from "./use-events";

/* ---------------------------------------------------------------------------
   Version 3 — Up Next.

   What is coming, in reading order, like the list view of Calendar on the
   iPhone: a small month to jump to a day, the calendars as filters, and
   on the right the next three weeks, one day per section. A row says the
   time and the title; opening it shows the rest in place.
--------------------------------------------------------------------------- */

const AHEAD = 21;

export function AgendaView({ source, today }: { source: Source; today: Date }) {
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [opened, setOpened] = useState<string | null>(null);
  const filter = useFilter();
  const grid = monthGrid(month);
  /* One read covers the small month and the three weeks ahead. */
  const from = grid[0] < selected ? grid[0] : selected;
  const until = addDays(selected, AHEAD) > grid[41] ? addDays(selected, AHEAD) : grid[41];
  const { events, loading, error } = useCalendarEvents(source, from, Math.round((until.getTime() - from.getTime()) / DAY) + 1, today);
  const shown = filter.apply(events);
  const days = byDay(shown);
  const counts: Partial<Record<Category, number>> = {};
  for (const e of events) counts[e.category] = (counts[e.category] ?? 0) + 1;
  const ahead = Array.from({ length: AHEAD }, (_, i) => addDays(selected, i)).filter((d, i) => i === 0 || days.has(dayKey(d)));

  const pick = (d: Date) => {
    setSelected(d);
    setOpened(null);
  };
  const label = (d: Date) => {
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, addDays(today, 1))) return "Tomorrow";
    return d.toLocaleDateString(LOCALE, { weekday: "long" });
  };

  return (
    <div className="cl-view a-view">
      <aside className="a-side">
        <div className="a-mini">
          <div className="a-mini-head">
            <span className="a-mini-title">{month.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}</span>
            <button type="button" className="cl-icon is-small" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
              <ChevronLeft />
            </button>
            <button type="button" className="cl-icon is-small" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
              <ChevronRight />
            </button>
          </div>
          <div className="a-mini-grid">
            {grid.slice(0, 7).map((d) => (
              <span key={`w${d.getDay()}`} className="a-mini-wd" aria-hidden>
                {d.toLocaleDateString(LOCALE, { weekday: "narrow" })}
              </span>
            ))}
            {grid.map((d) => {
              const list = days.get(dayKey(d)) ?? [];
              const tones = [...new Set(list.map((e) => e.category))].slice(0, 3);
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  className={`a-mini-day${d.getMonth() !== month.getMonth() ? " is-outside" : ""}${sameDay(d, today) ? " is-today" : ""}${sameDay(d, selected) ? " is-selected" : ""}`}
                  onClick={() => pick(d)}
                  aria-label={`${d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}, ${list.length} event${list.length === 1 ? "" : "s"}`}
                >
                  <span className="a-mini-num">{d.getDate()}</span>
                  <span className="a-mini-dots" aria-hidden>
                    {tones.map((c) => (
                      <i key={c} style={{ background: CATEGORY_TONE[c] }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="cl-today a-mini-today"
            onClick={() => {
              pick(today);
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
          >
            Today
          </button>
        </div>
        <CalendarList filter={filter} counts={counts} />
      </aside>

      <main className="a-main">
        <header className="a-head">
          <h1 className="cl-title">{label(selected)}</h1>
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
                  <h2 className="a-day-title">
                    {label(d)} <span className="a-day-date">{d.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}</span>
                  </h2>
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
