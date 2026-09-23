"use client";

import { useEffect, useState } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { DAY_MS, byDay, eventDay, firstOfMonth, monthGrid, periodDays, sameMonth, startOfDay, type Period } from "@/lib/plugins/calendar/days";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { Agenda, type Collection } from "./agenda";
import { useFilter } from "./filters";
import { MonthPane, type PeriodKey } from "./month";
import "./calendar.css";

/* ---------------------------------------------------------------------------
   The Calendar tab: the market events, the month on the left and the
   chosen period on the right, like Calendar on the iPad.

   It lies on the app's own backdrop: one veil that darkens the light
   beams behind it, never a card of its own — the backdrop belongs to the
   app, and the text keeps its contrast whatever it shows.
--------------------------------------------------------------------------- */

type Week = { events: CalendarEvent[]; last: Collection; watchlist: boolean };

/** The data is read again now and then: a collection lands in the background. */
const REFRESH = 30_000;
/** How long "Collecting" is shown at most: the scheduler says a failure. */
const COLLECT_MS = 12 * 60_000;

export function CalendarView({ settings }: ViewProps) {
  const [today] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => firstOfMonth(today));
  const [period, setPeriod] = useState<Period>(() => ({ kind: "day", day: today }));
  const [requested, setRequested] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const filter = useFilter();

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

  useEffect(() => {
    const t = setInterval(reload, REFRESH);
    return () => clearInterval(t);
  }, [reload]);

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
      <div className="calv-panel">
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
        <Agenda period={period} span={span} today={today} days={days} last={data?.last ?? null} loading={loading && !data} problem={problem ?? error ?? null} collecting={collecting} onCollect={() => void collect()} onPick={pick} />
      </div>
    </div>
  );
}
