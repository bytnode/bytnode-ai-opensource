"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { addDays, byDay, CATEGORY_TONE, DAY, dayKey, eventDay, LOCALE, monthGrid, sameDay, startOfWeek, timeOf } from "./model";
import { CalendarFilters, EventCard, MonthTitle, Segmented, tone, useFilter } from "./parts";
import { useCalendarEvents, type Source } from "./use-events";

/* ---------------------------------------------------------------------------
   Version 3 — Up Next.

   The month and what is coming, side by side, like Calendar on the iPad:
   on the left the month — every day with its coloured marks — a choice of
   period (today, this week, this month) and the calendars as an ordered
   grid of filters; on the right the chosen period, one section per day. A
   day clicked in the month shows that day. The month and the year of the
   title open their pickers. A row says the time and the title; opening it
   shows the rest in place.
--------------------------------------------------------------------------- */

const MARKS = 4;

type Period = { kind: "day"; day: Date } | { kind: "week" } | { kind: "month" };
type PeriodKey = "today" | "week" | "month";

const PERIODS: Array<{ value: PeriodKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

/** The days a period covers. */
function daysOf(period: Period, today: Date): Date[] {
  if (period.kind === "day") return [period.day];
  if (period.kind === "week") return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i));
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

export function AgendaView({ source, today }: { source: Source; today: Date }) {
  const [period, setPeriod] = useState<Period>(() => ({ kind: "day", day: today }));
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [opened, setOpened] = useState<string | null>(null);
  const filter = useFilter();
  const grid = monthGrid(month);
  const span = daysOf(period, today);
  /* One read covers the month on the left and the period on the right. */
  const from = grid[0] < span[0] ? grid[0] : span[0];
  const last = span[span.length - 1] > grid[41] ? span[span.length - 1] : grid[41];
  const { events, loading, error } = useCalendarEvents(source, from, Math.round((last.getTime() - from.getTime()) / DAY) + 1, today);
  const days = byDay(filter.apply(events));
  /* The counts of the month on screen, whatever the period. */
  const counts: Partial<Record<Category, number>> = {};
  for (const e of events) {
    const d = eventDay(e);
    if (d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear()) counts[e.category] = (counts[e.category] ?? 0) + 1;
  }
  const agenda = useRef<HTMLDivElement>(null);
  const periodId = period.kind === "day" ? dayKey(period.day) : period.kind;

  /* A week or a month opens on today: the days gone stay above, faded. */
  useEffect(() => {
    const box = agenda.current;
    if (!box) return;
    const next = box.querySelector<HTMLElement>(".a-day:not(.is-past)");
    box.scrollTop = next ? next.offsetTop : 0;
  }, [periodId, loading]);

  const key: PeriodKey | null = period.kind === "day" ? (sameDay(period.day, today) ? "today" : null) : period.kind;
  const choose = (k: PeriodKey) => {
    setPeriod(k === "today" ? { kind: "day", day: today } : { kind: k });
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setOpened(null);
  };
  const pick = (d: Date) => {
    setPeriod({ kind: "day", day: d });
    setOpened(null);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const label = (d: Date) => {
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, addDays(today, 1))) return "Tomorrow";
    return d.toLocaleDateString(LOCALE, { weekday: "long" });
  };
  const inWeek = (d: Date) => period.kind === "week" && span.some((x) => sameDay(x, d));

  /* What the right side shows: every day of a week, only the busy days of a
     month, the one day otherwise. */
  const shown = period.kind === "month" ? span.filter((d) => days.has(dayKey(d))) : span;
  const head =
    period.kind === "day"
      ? { title: label(period.day), sub: period.day.toLocaleDateString(LOCALE, { weekday: sameDay(period.day, today) ? "long" : undefined, day: "numeric", month: "long", year: "numeric" }) }
      : period.kind === "week"
        ? { title: "This week", sub: `${span[0].toLocaleDateString(LOCALE, { day: "numeric", month: span[0].getMonth() === span[6].getMonth() ? undefined : "short" })} – ${span[6].toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" })}` }
        : { title: "This month", sub: today.toLocaleDateString(LOCALE, { month: "long", year: "numeric" }) };

  return (
    <div className="cl-view a-view">
      <section className="a-cal" aria-label="Month">
        <header className="cl-bar a-cal-bar">
          <MonthTitle month={month} today={today} onChange={setMonth} />
          <span className="cl-spacer" />
          <button type="button" className="cl-icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <button type="button" className="cl-icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
            <ChevronRight />
          </button>
        </header>
        <div className="a-periods">
          <Segmented label="Period" value={key} options={PERIODS} onChange={choose} />
        </div>
        <div className="a-cal-weekdays" aria-hidden>
          {grid.slice(0, 7).map((d) => (
            <span key={d.getDay()}>{d.toLocaleDateString(LOCALE, { weekday: "short" })}</span>
          ))}
        </div>
        <div className="a-cal-grid" role="grid" aria-label={month.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}>
          {grid.map((d) => {
            const list = days.get(dayKey(d)) ?? [];
            const selected = period.kind === "day" && sameDay(d, period.day);
            return (
              <button
                key={d.getTime()}
                type="button"
                role="gridcell"
                aria-selected={selected}
                className={`a-cal-day${d.getMonth() !== month.getMonth() ? " is-outside" : ""}${sameDay(d, today) ? " is-today" : ""}${selected ? " is-selected" : ""}${inWeek(d) ? " in-range" : ""}`}
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
          <h2 className="a-head-title">{head.title}</h2>
          <p className="a-head-date">{head.sub}</p>
          {loading && <span className="cl-status">Loading…</span>}
          {error && <span className="cl-status is-error">{error}</span>}
        </header>
        <div className="a-list" ref={agenda}>
          {shown.length === 0 && <p className="cl-empty a-none">Nothing scheduled this month.</p>}
          {shown.map((d) => {
            const list = days.get(dayKey(d)) ?? [];
            const past = d < today;
            return (
              <section key={d.getTime()} className={`a-day${past ? " is-past" : ""}`} aria-label={d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}>
                {period.kind !== "day" && (
                  <h3 className="a-day-title">
                    {label(d)} <span className="a-day-date">{d.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}</span>
                  </h3>
                )}
                {list.length === 0 ? (
                  <p className="cl-empty a-day-empty">Nothing scheduled.</p>
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
