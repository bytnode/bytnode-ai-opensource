"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { dayKey, isoWeek, sameDay, weeksOf } from "@/lib/plugins/calendar/days";
import { ChevronRight } from "@/components/ui/icons";
import { EventFacts } from "./event-facts";
import { HourScale } from "./hours";
import { LOCALE, dayLabel, timeOf, toneOf } from "./format";

/* The week and the month as scales that fold: a week is its seven days,
   each one opening on its hours; a month is its weeks, each one opening
   on its days. A closed row still says what it holds — its first events
   as tinted chips, the rest as a count. Today, or this week, is open
   when the view comes up; a row the user opens scrolls up to the top of
   the list, so what it holds comes into view. */

const CHIPS = 2;

type Days = Map<string, CalendarEvent[]>;

function useFolds(initial: string[]) {
  const [open, setOpen] = useState(initial);
  return {
    has: (k: string) => open.includes(k),
    toggle: (k: string) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k])),
  };
}

export function WeekScale({ span, days, today, now }: { span: Date[]; days: Days; today: Date; now: Date }) {
  const folds = useFolds([dayKey(today)]);
  return (
    <div className="calv-folds">
      {span.map((d) => {
        const k = dayKey(d);
        const events = days.get(k) ?? [];
        return (
          <Fold
            key={k}
            open={folds.has(k)}
            onToggle={() => folds.toggle(k)}
            past={d < today}
            current={sameDay(d, today)}
            title={dayLabel(d, today)}
            date={d.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}
            events={events}
          >
            <HourScale day={d} events={events} now={now} />
          </Fold>
        );
      })}
    </div>
  );
}

export function MonthScale({ span, days, today }: { span: Date[]; days: Days; today: Date }) {
  const weeks = weeksOf(span);
  const current = weeks.find((w) => w.some((d) => sameDay(d, today)));
  const folds = useFolds(current ? [dayKey(current[0])] : []);
  const [opened, setOpened] = useState<string | null>(null);

  return (
    <div className="calv-folds">
      {weeks.map((w) => {
        const k = dayKey(w[0]);
        const last = w[w.length - 1];
        const date = w.length === 1 ? last.toLocaleDateString(LOCALE, { day: "numeric", month: "long" }) : `${w[0].getDate()} – ${last.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}`;
        return (
          <Fold
            key={k}
            open={folds.has(k)}
            onToggle={() => folds.toggle(k)}
            past={last < today}
            current={w === current}
            title={`Week ${isoWeek(w[0])}`}
            date={date}
            events={w.flatMap((d) => days.get(dayKey(d)) ?? [])}
          >
            {w.map((d) => {
              const list = days.get(dayKey(d)) ?? [];
              return (
                <section key={d.getTime()} className={`calv-day-section${d < today ? " is-past" : ""}${sameDay(d, today) ? " is-today" : ""}`}>
                  <h4 className="calv-day-title">
                    <span className="calv-ink">{dayLabel(d, today)}</span> <span className="calv-day-date">{d.toLocaleDateString(LOCALE, { day: "numeric", month: "long" })}</span>
                    {list.length === 0 && <span className="calv-day-none">No events</span>}
                  </h4>
                  {list.length > 0 && (
                    <ul className="calv-rows">
                      {list.map((e) => (
                        <Row key={e.id} event={e} open={opened === e.id} onToggle={() => setOpened(opened === e.id ? null : e.id)} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </Fold>
        );
      })}
    </div>
  );
}

type FoldProps = {
  open: boolean;
  onToggle: () => void;
  past: boolean;
  /** Today's row, or this week's: its title in red. */
  current: boolean;
  title: string;
  date: string;
  events: CalendarEvent[];
  children: ReactNode;
};

function Fold({ open, onToggle, past, current, title, date, events, children }: FoldProps) {
  const root = useRef<HTMLElement>(null);
  /* Set by the click that opens the row: the rows open when the view
     comes up stay where they are. */
  const opening = useRef(false);

  useEffect(() => {
    if (!open || !opening.current) return;
    opening.current = false;
    const row = root.current;
    const list = row?.closest<HTMLElement>(".calv-list");
    if (!row || !list) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ top: list.scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top, behavior: still ? "auto" : "smooth" });
  }, [open]);

  return (
    <section ref={root} className={`calv-fold${open ? " is-open" : ""}${past ? " is-past" : ""}${current ? " is-current" : ""}`}>
      <button
        type="button"
        className="calv-fold-head"
        aria-expanded={open}
        onClick={() => {
          opening.current = !open;
          onToggle();
        }}
      >
        <span className="calv-fold-chev" aria-hidden>
          <ChevronRight />
        </span>
        <span className="calv-fold-title calv-ink">{title}</span>
        <span className="calv-fold-date">{date}</span>
        {events.length === 0 ? (
          <span className="calv-fold-count">No events</span>
        ) : open ? (
          <span className="calv-fold-count">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="calv-fold-chips">
            {events.slice(0, CHIPS).map((e) => (
              <span key={e.id} className={`calv-chip${e.importance === 3 ? " is-strong" : ""}`} style={toneOf(e.category)}>
                {e.title}
              </span>
            ))}
            {events.length > CHIPS && <span className="calv-fold-count">+{events.length - CHIPS}</span>}
          </span>
        )}
      </button>
      {open && <div className="calv-fold-body">{children}</div>}
    </section>
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
