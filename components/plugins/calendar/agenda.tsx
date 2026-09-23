"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { dayKey, nextBusyDay, sameDay, type Period } from "@/lib/plugins/calendar/days";
import { ChevronRight, Refresh } from "@/components/ui/icons";
import { HourScale } from "./hours";
import { WeekGrid, WeekHead } from "./week-grid";
import { LOCALE, dayLabel } from "./format";

/* The right pane: the chosen period on a scale of time — a day on its
   hours, or this week as a grid of days by hours, the days' heads right
   above it. An empty day points to the next day that has something. The
   collection's state and "Collect now" sit discreetly in the corner. */

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

export function Agenda({ period, span, today, days, last, loading, problem, collecting, onCollect, onPick }: Props) {
  const [now, setNow] = useState(() => new Date());
  const list = useRef<HTMLDivElement>(null);
  const periodId = period.kind === "day" ? dayKey(period.day) : period.kind;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK);
    return () => clearInterval(t);
  }, []);

  /* A day or the week opens on the first hours that matter, their first
     tile right under the heads. */
  useEffect(() => {
    const box = list.current;
    if (!box) return;
    box.scrollTop = 0;
    const anchor = box.querySelector<HTMLElement>("[data-anchor]");
    if (anchor) box.scrollTop = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, [periodId, loading]);

  const shown = span.flatMap((d) => days.get(dayKey(d)) ?? []);
  const empty = period.kind === "day" && !loading && shown.length === 0;
  const next = empty ? nextBusyDay(days, period.day) : null;
  const anchor = anchorHour(shown, span.some((d) => sameDay(d, now)) ? now : null);
  const head =
    period.kind === "day"
      ? { title: dayLabel(period.day, today), sub: period.day.toLocaleDateString(LOCALE, { weekday: sameDay(period.day, today) ? "long" : undefined, day: "numeric", month: "long", year: "numeric" }) }
      : { title: "This week", sub: `${span[0].toLocaleDateString(LOCALE, { day: "numeric", month: span[0].getMonth() === span[6].getMonth() ? undefined : "short" })} – ${span[6].toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" })}` };
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
      {period.kind === "week" && <WeekHead span={span} today={today} onPick={onPick} />}
      <div className={`calv-list${period.kind === "week" ? " is-week" : ""}`} ref={list}>
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
