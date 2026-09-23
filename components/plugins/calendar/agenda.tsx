"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { dayKey, nextBusyDay, sameDay, type Period } from "@/lib/plugins/calendar/days";
import { ChevronRight, Refresh } from "@/components/ui/icons";
import { MonthScale, WeekScale } from "./folds";
import { HourScale } from "./hours";
import { LOCALE, dayLabel } from "./format";

/* The right pane: the chosen period on a scale of time — a day on its
   hours, this week on its days (each opening on its hours), this month on
   its weeks (each opening on its days). An empty day points to the next
   day that has something. The collection's state and "Collect now" sit
   discreetly in the corner. */

export type Collection = { at: string; days: number; added: number; updated: number; rejected: string[] } | null;

type Props = {
  period: Period;
  span: Date[];
  today: Date;
  days: Map<string, CalendarEvent[]>;
  last: Collection;
  loading: boolean;
  problem: string | null;
  collecting: boolean;
  onCollect: () => void;
  onPick: (day: Date) => void;
};

/** The red line of the day moves with the clock. */
const TICK = 60_000;
/** An hour's label sits on its line, half above it: room kept for it. */
const LABEL_ROOM = 12;

export function Agenda({ period, span, today, days, last, loading, problem, collecting, onCollect, onPick }: Props) {
  const [now, setNow] = useState(() => new Date());
  const list = useRef<HTMLDivElement>(null);
  const periodId = period.kind === "day" ? dayKey(period.day) : period.kind;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK);
    return () => clearInterval(t);
  }, []);

  /* A day opens on the first hours that matter (under its all-day
     events, which stay pinned on top); a week or a month at its start. */
  useEffect(() => {
    const box = list.current;
    if (!box) return;
    box.scrollTop = 0;
    const anchor = box.querySelector<HTMLElement>("[data-anchor]");
    if (!anchor) return;
    const pinned = box.querySelector<HTMLElement>(".calv-hour.is-allday")?.offsetHeight ?? 0;
    box.scrollTop = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top - pinned - LABEL_ROOM;
  }, [periodId, loading]);

  const dayEvents = period.kind === "day" ? (days.get(dayKey(period.day)) ?? []) : [];
  const empty = period.kind === "day" && !loading && dayEvents.length === 0;
  const next = empty ? nextBusyDay(days, period.day) : null;
  const head =
    period.kind === "day"
      ? { title: dayLabel(period.day, today), sub: period.day.toLocaleDateString(LOCALE, { weekday: sameDay(period.day, today) ? "long" : undefined, day: "numeric", month: "long", year: "numeric" }) }
      : period.kind === "week"
        ? { title: "This week", sub: `${span[0].toLocaleDateString(LOCALE, { day: "numeric", month: span[0].getMonth() === span[6].getMonth() ? undefined : "short" })} – ${span[6].toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" })}` }
        : { title: "This month", sub: today.toLocaleDateString(LOCALE, { month: "long", year: "numeric" }) };
  const status = loading
    ? "Loading…"
    : collecting
      ? "Collecting — a few minutes"
      : last
        ? `Updated ${new Date(last.at).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : "Not collected yet";

  return (
    <main className="calv-pane calv-agenda">
      <header className="calv-agenda-head">
        <div>
          <h2 className="calv-agenda-title calv-ink">{head.title}</h2>
          <p className="calv-agenda-sub">{head.sub}</p>
          {empty && (
            <p className="calv-agenda-empty">
              No events
              {next && (
                <button type="button" className="calv-next" onClick={() => onPick(next)}>
                  Next event: {dayLabel(next, today)}, {next.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}
                  <ChevronRight />
                </button>
              )}
            </p>
          )}
        </div>
        <span className="calv-spacer" />
        <span className="calv-collect-status" title={last ? `Last collection: ${last.added} new, ${last.updated} updated, ${last.rejected.length} rejected (no source or no date).` : undefined}>
          {status}
        </span>
        <button type="button" className="calv-icon" onClick={onCollect} disabled={collecting} aria-label="Collect the events now" title="Collect the events of the next 7 days now">
          <Refresh />
        </button>
      </header>
      {problem && <p className="calv-problem">{problem}</p>}
      <div className="calv-list" ref={list}>
        {period.kind === "day" ? (
          <HourScale key={periodId} day={period.day} events={dayEvents} now={now} anchor={anchorHour(period.day, dayEvents, now)} />
        ) : period.kind === "week" ? (
          <WeekScale span={span} days={days} today={today} now={now} />
        ) : (
          <MonthScale span={span} days={days} today={today} />
        )}
      </div>
    </main>
  );
}

/** The hour a day opens on: an hour before its first timed event, or
    before now on today, whichever comes first; 08:00 on an empty day. */
function anchorHour(day: Date, events: CalendarEvent[], now: Date): number {
  const first = events.find((e) => !e.allDay);
  const hours = [first ? new Date(first.startsAt).getHours() : null, sameDay(day, now) ? now.getHours() : null].filter((h): h is number => h !== null);
  return hours.length ? Math.max(0, Math.min(...hours) - 1) : 8;
}
