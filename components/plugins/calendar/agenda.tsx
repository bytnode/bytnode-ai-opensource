"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { addDays, dayKey, nextBusyDay, sameDay, type Period } from "@/lib/plugins/calendar/days";
import { ChevronRight, Refresh } from "@/components/ui/icons";
import { EventFacts } from "./event-facts";
import { LOCALE, timeOf, toneOf } from "./format";

/* The right pane: the chosen period, one section per day — every day of a
   week, the busy days of a month, the one day otherwise. A week or a month
   opens on today, the days gone above it, faded. A row says the time and
   the title; opening it shows the rest in place. The collection's state
   and "Collect now" sit discreetly in the corner; an empty day says so
   plainly and points to the next day that has something. */

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

export function Agenda({ period, span, today, days, last, loading, problem, collecting, onCollect, onPick }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const periodId = period.kind === "day" ? dayKey(period.day) : period.kind;

  useEffect(() => {
    const box = list.current;
    if (!box) return;
    const next = box.querySelector<HTMLElement>(".calv-day-section:not(.is-past)");
    box.scrollTop = next ? next.offsetTop : 0;
  }, [periodId, loading]);

  const label = (d: Date) => {
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, addDays(today, 1))) return "Tomorrow";
    return d.toLocaleDateString(LOCALE, { weekday: "long" });
  };
  const shown = period.kind === "month" ? span.filter((d) => days.has(dayKey(d))) : span;
  const next = period.kind === "day" ? nextBusyDay(days, period.day) : null;
  const head =
    period.kind === "day"
      ? { title: label(period.day), sub: period.day.toLocaleDateString(LOCALE, { weekday: sameDay(period.day, today) ? "long" : undefined, day: "numeric", month: "long", year: "numeric" }) }
      : period.kind === "week"
        ? { title: "This week", sub: `${span[0].toLocaleDateString(LOCALE, { day: "numeric", month: span[0].getMonth() === span[6].getMonth() ? undefined : "short" })} – ${span[6].toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" })}` }
        : { title: "This month", sub: today.toLocaleDateString(LOCALE, { month: "long", year: "numeric" }) };
  const status = collecting
    ? "Collecting — a few minutes"
    : last
      ? `Updated ${new Date(last.at).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : "Not collected yet";

  return (
    <main className="calv-pane calv-agenda">
      <header className="calv-agenda-head">
        <div>
          <h2 className="calv-agenda-title">{head.title}</h2>
          <p className="calv-agenda-sub">{head.sub}</p>
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
        {shown.length === 0 && <p className="calv-empty calv-none">{loading ? "Loading…" : "Nothing scheduled this month."}</p>}
        {shown.map((d) => {
          const events = days.get(dayKey(d)) ?? [];
          return (
            <section key={d.getTime()} className={`calv-day-section${d < today ? " is-past" : ""}`} aria-label={d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}>
              {period.kind !== "day" && (
                <h3 className="calv-day-title">
                  {label(d)} <span className="calv-day-date">{d.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}</span>
                  {events.length === 0 && <span className="calv-day-none">{loading ? "Loading…" : "No events"}</span>}
                </h3>
              )}
              {events.length === 0 && period.kind === "day" && !loading ? (
                <div className="calv-rest">
                  <p className="calv-rest-title">No events</p>
                  {next && (
                    <button type="button" className="calv-rest-next" onClick={() => onPick(next)}>
                      Next event: {label(next)}, {next.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}
                      <ChevronRight />
                    </button>
                  )}
                </div>
              ) : events.length === 0 ? (
                period.kind === "day" && <p className="calv-empty calv-day-empty">Loading…</p>
              ) : (
                <ul className="calv-rows">
                  {events.map((e) => (
                    <Row key={e.id} event={e} open={opened === e.id} onToggle={() => setOpened(opened === e.id ? null : e.id)} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function Row({ event, open, onToggle }: { event: CalendarEvent; open: boolean; onToggle: () => void }) {
  return (
    <li className={`calv-row${open ? " is-open" : ""}${event.importance === 3 ? " is-strong" : ""}`} style={toneOf(event.category)}>
      <button type="button" className="calv-row-main" onClick={onToggle} aria-expanded={open}>
        <span className="calv-row-time">{event.allDay ? "all-day" : timeOf(event)}</span>
        <span className="calv-row-rule" aria-hidden />
        <span className="calv-row-title">{event.title}</span>
        {event.assets.length > 0 && <span className="calv-row-assets">{event.assets.join(", ")}</span>}
      </button>
      {open && (
        <div className="calv-row-detail">
          <EventFacts event={event} />
        </div>
      )}
    </li>
  );
}
