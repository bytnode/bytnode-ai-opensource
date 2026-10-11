"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { dayKey, nextBusyDay, sameDay, type Period } from "@/lib/plugins/calendar/days";
import { ChevronRight } from "@/components/ui/icons";
import { useAwakeInterval, useViewActive } from "../view-activity";
import { HourScale } from "./hours";
import { WeekGrid, WeekHead } from "./week-grid";
import { locale, dayLabel } from "./format";
import { useMessages } from "@/lib/i18n/react";

/* The right pane: the chosen period on a scale of time — a day on its
   hours, or this week as a grid of days by hours, the days' heads right
   above it. An empty day points to the next day that has something, and
   says who fills the calendar: the user's agents, when asked. */

type Props = {
  period: Period;
  span: Date[];
  today: Date;
  days: Map<string, CalendarEvent[]>;
  loading: boolean;
  problem: string | null;
  onPick: (day: Date) => void;
};

/** The red line of the day moves with the clock. */
const TICK = 60_000;

export function Agenda({ period, span, today, days, loading, problem, onPick }: Props) {
  const t = useMessages();
  const w = t.calendar;
  const [now, setNow] = useState(() => new Date());
  const list = useRef<HTMLDivElement>(null);
  /* What the list was last placed on: it is placed once per period, not
     again when the tab comes back from sleep (the scroll stays as left). */
  const placed = useRef("");
  const active = useViewActive();
  const periodId = period.kind === "day" ? dayKey(period.day) : period.kind;

  const tick = useCallback(() => setNow(new Date()), []);
  useAwakeInterval(tick, TICK);

  /* A day or the week opens on the first hours that matter, their first
     tile right under the heads — once shown: a tab asleep has no layout
     to measure. */
  useEffect(() => {
    const box = list.current;
    const key = `${periodId}|${loading}`;
    if (!box || !active || placed.current === key) return;
    placed.current = key;
    box.scrollTop = 0;
    const anchor = box.querySelector<HTMLElement>("[data-anchor]");
    if (anchor) box.scrollTop = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, [periodId, loading, active]);

  const shown = span.flatMap((d) => days.get(dayKey(d)) ?? []);
  const empty = period.kind === "day" && !loading && shown.length === 0;
  const next = empty ? nextBusyDay(days, period.day) : null;
  const anchor = anchorHour(shown, span.some((d) => sameDay(d, now)) ? now : null);
  const head =
    period.kind === "day"
      ? { title: dayLabel(period.day, today), sub: period.day.toLocaleDateString(locale(), { weekday: sameDay(period.day, today) ? "long" : undefined, day: "numeric", month: "long", year: "numeric" }) }
      : { title: w.thisWeek, sub: `${span[0].toLocaleDateString(locale(), { day: "numeric", month: span[0].getMonth() === span[6].getMonth() ? undefined : "short" })} – ${span[6].toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" })}` };
  return (
    <main className="calv-pane calv-agenda">
      <header className="calv-agenda-head">
        <div>
          <h2 className="calv-agenda-title calv-ink">{head.title}</h2>
          <p className="calv-agenda-sub">{head.sub}</p>
          {empty && (
            <p className="calv-agenda-empty">
              {w.nothingToday}
              {next && (
                <button type="button" className="calv-next" onClick={() => onPick(next)}>
                  {w.nextEvent(`${dayLabel(next, today)}, ${next.toLocaleDateString(locale(), { day: "numeric", month: "long" })}`)}
                  <ChevronRight />
                </button>
              )}
              <span className="calv-agenda-hint">{w.askAgent}</span>
            </p>
          )}
        </div>
      </header>
      {problem && <p className="calv-problem">{problem}</p>}
      {period.kind === "week" && <WeekHead span={span} today={today} onPick={onPick} />}
      <div className={`pv-tiles calv-list${period.kind === "week" ? " is-week" : ""}`} ref={list}>
        {period.kind === "day" ? <HourScale key={periodId} day={period.day} events={shown} now={now} anchor={anchor} /> : <WeekGrid span={span} days={days} today={today} now={now} anchor={anchor} />}
      </div>
    </main>
  );
}

/** The hour a day or the week opens on: an hour before its earliest
    timed event, or before now when it holds today, whichever comes first;
    08:00 when there is neither. */
function anchorHour(events: CalendarEvent[], now: Date | null): number {
  const hours = events.filter((e) => !e.allDay).map((e) => new Date(e.startsAt).getHours());
  if (now) hours.push(now.getHours());
  return hours.length ? Math.max(0, Math.min(...hours) - 1) : 8;
}
