"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { DAY_MS, byDay, eventDay, firstOfMonth, monthGrid, periodDays, sameMonth, startOfDay, type Period } from "@/lib/plugins/calendar/days";
import { CALENDAR_DEFAULT, CALENDAR_MAX, CALENDAR_MIN, clampCalendarWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { Agenda, type Collection } from "./agenda";
import { useFilter } from "./filters";
import { recall, remember } from "./memory";
import { MonthPane, type PeriodKey } from "./month";
import "./calendar.css";

/* ---------------------------------------------------------------------------
   The Calendar tab: the market events, the month on the left and the
   chosen period on the right, like Calendar on the iPad.

   It lies on the app's own backdrop, never a card of its own. The rule
   between the two columns is a handle (`../column-handle.tsx`) that widens
   or narrows the month — a screen habit, kept with the others. Where the
   tab was left — period, month, filters — survives a visit to another
   tab (`./memory.ts`).
--------------------------------------------------------------------------- */

type Week = { events: CalendarEvent[]; last: Collection; watchlist: boolean };

/** The data is read again now and then: a collection lands in the background. */
const REFRESH = 30_000;
/** How long "Collecting" is shown at most: the scheduler says a failure. */
const COLLECT_MS = 12 * 60_000;

export function CalendarView({ settings }: ViewProps) {
  const [today] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => recall().month ?? firstOfMonth(today));
  const [period, setPeriod] = useState<Period>(() => recall().period ?? { kind: "day", day: today });
  const [requested, setRequested] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const filter = useFilter();
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    remember({ period, month });
  }, [period, month]);

  const grid = monthGrid(month);
  const span = periodDays(period, today);
  /* One read covers the month on the left and the period on the right. */
  const from = grid[0] < span[0] ? grid[0] : span[0];
  const last = span[span.length - 1] > grid[41] ? span[span.length - 1] : grid[41];
  const { data, error, loading, reload } = usePluginData<Week>("calendar", "week", settings, {
    from: from.toISOString(),
    days: Math.round((last.getTime() - from.getTime()) / DAY_MS) + 1,
    watchlist: filter.watchlistOnly,
  });

  useAwakeInterval(reload, REFRESH);

  useEffect(() => {
    if (requested === null) return;
    const t = setTimeout(() => setRequested(null), COLLECT_MS);
    return () => clearTimeout(t);
  }, [requested]);

  const events = data?.events ?? [];
  const days = byDay(filter.apply(events));
  const counts: Partial<Record<Category, number>> = {};
  for (const e of events) if (sameMonth(eventDay(e), month)) counts[e.category] = (counts[e.category] ?? 0) + 1;
  const collecting = requested !== null && (data?.last?.at ?? "") === requested;

  const choose = (k: PeriodKey) => {
    setPeriod(k === "today" ? { kind: "day", day: today } : { kind: k });
    setMonth(firstOfMonth(today));
  };
  const pick = (d: Date) => {
    setPeriod({ kind: "day", day: d });
    if (!sameMonth(d, month)) setMonth(firstOfMonth(d));
  };
  const collect = async () => {
    const p = await act("calendar", "refresh", { days: 7 }, settings);
    setProblem(p);
    if (!p) setRequested(data?.last?.at ?? "");
  };

  return (
    <div className="calv">
      <div className="calv-panel" ref={panel} style={{ "--calv-month": `${ui.calendarWidth}px` } as CSSProperties}>
        <MonthPane
          month={month}
          today={today}
          period={period}
          span={span}
          days={days}
          counts={counts}
          filter={filter}
          watchlist={data?.watchlist ?? false}
          onMonth={setMonth}
          onPeriod={choose}
          onDay={pick}
        />
        <ColumnHandle
          panel={panel}
          cssVar="--calv-month"
          width={ui.calendarWidth}
          min={CALENDAR_MIN}
          max={CALENDAR_MAX}
          reset={CALENDAR_DEFAULT}
          clamp={clampCalendarWidth}
          onCommit={(w) => updateUiPrefs({ calendarWidth: w })}
          label="Width of the month column"
        />
        <Agenda period={period} span={span} today={today} days={days} last={data?.last ?? null} loading={loading && !data} problem={problem ?? error ?? null} collecting={collecting} onCollect={() => void collect()} onPick={pick} />
      </div>
    </div>
  );
}
