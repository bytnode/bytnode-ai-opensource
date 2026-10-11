"use client";

import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { addMonths, dayKey, monthGrid, sameDay, sameMonth, type Period } from "@/lib/plugins/calendar/days";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { CalendarFilters, type FilterState } from "./filters";
import { locale, TONE } from "./format";
import { MonthTitle } from "./month-title";
import { useMessages } from "@/lib/i18n/react";
import { capitalize } from "@/lib/plugins/shared/frequency-words";

/* The left pane: the month (its title opens the month and year pickers),
   the period to show on the right (today or this week), the days with a
   coloured mark per event — a market-moving one as a short bar — and the
   calendars. */

const MARKS = 4;

export type PeriodKey = "today" | "week";

type Props = {
  month: Date;
  today: Date;
  period: Period;
  span: Date[];
  days: Map<string, CalendarEvent[]>;
  counts: Partial<Record<Category, number>>;
  filter: FilterState;
  watchlist: boolean;
  onMonth: (month: Date) => void;
  onPeriod: (key: PeriodKey) => void;
  onDay: (day: Date) => void;
};

export function MonthPane({ month, today, period, span, days, counts, filter, watchlist, onMonth, onPeriod, onDay }: Props) {
  const t = useMessages();
  const w = t.calendar;
  const periods: Array<{ value: PeriodKey; label: string }> = [
    { value: "today", label: t.common.today },
    { value: "week", label: w.thisWeek },
  ];
  const grid = monthGrid(month);
  const key: PeriodKey | null = period.kind === "day" ? (sameDay(period.day, today) ? "today" : null) : period.kind;
  const inWeek = (d: Date) => period.kind === "week" && span.some((x) => sameDay(x, d));

  return (
    <section className="calv-pane calv-month" aria-label={w.month}>
      <header className="calv-month-bar">
        <MonthTitle month={month} today={today} onChange={onMonth} />
        <span className="calv-spacer" />
        <button type="button" className="calv-icon" onClick={() => onMonth(addMonths(month, -1))} aria-label={w.previousMonth}>
          <ChevronLeft />
        </button>
        <button type="button" className="calv-icon" onClick={() => onMonth(addMonths(month, 1))} aria-label={w.nextMonth}>
          <ChevronRight />
        </button>
      </header>
      <div className="calv-periods">
        <Segmented label={w.period} value={key} options={periods} onChange={onPeriod} wide />
      </div>
      <div className="calv-weekdays" aria-hidden>
        {grid.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{capitalize(d.toLocaleDateString(locale(), { weekday: "short" }))}</span>
        ))}
      </div>
      <div className="calv-grid" role="grid" aria-label={month.toLocaleDateString(locale(), { month: "long", year: "numeric" })}>
        {grid.map((d) => {
          const list = days.get(dayKey(d)) ?? [];
          const selected = period.kind === "day" && sameDay(d, period.day);
          return (
            <button
              key={d.getTime()}
              type="button"
              role="gridcell"
              aria-selected={selected}
              className={`calv-day${sameMonth(d, month) ? "" : " is-outside"}${sameDay(d, today) ? " is-today" : ""}${selected ? " is-selected" : ""}${inWeek(d) ? " in-range" : ""}`}
              onClick={() => onDay(d)}
              aria-label={w.dayEvents(d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }), list.length)}
            >
              <span className="calv-num">{d.getDate()}</span>
              <span className="calv-marks" aria-hidden>
                {list.slice(0, MARKS).map((e) => (
                  <i key={e.id} className={e.importance === 3 ? "is-strong" : undefined} style={{ background: TONE[e.category] }} />
                ))}
                {list.length > MARKS && <b>+{list.length - MARKS}</b>}
              </span>
            </button>
          );
        })}
      </div>
      <CalendarFilters filter={filter} counts={counts} watchlist={watchlist} />
    </section>
  );
}
