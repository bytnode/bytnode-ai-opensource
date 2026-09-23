"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CATEGORIES, CATEGORY_LABELS, type CalendarEvent, type Category } from "@/lib/plugins/calendar/events";
import { ChevronLeft, ChevronRight, Filter } from "@/components/ui/icons";
import { CATEGORY_TONE, eventDay, LOCALE, timeOf } from "./model";

/* The pieces the three calendar designs share: the segmented control, the
   previous / today / next stepper, the calendars filter, and the card of
   one event. */

export const tone = (e: CalendarEvent) => ({ "--tone": CATEGORY_TONE[e.category] }) as CSSProperties;

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cl-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "is-on" : undefined} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ onPrev, onToday, onNext, unit }: { onPrev: () => void; onToday: () => void; onNext: () => void; unit: string }) {
  return (
    <div className="cl-stepper">
      <button type="button" className="cl-icon" onClick={onPrev} aria-label={`Previous ${unit}`}>
        <ChevronLeft />
      </button>
      <button type="button" className="cl-today" onClick={onToday}>
        Today
      </button>
      <button type="button" className="cl-icon" onClick={onNext} aria-label={`Next ${unit}`}>
        <ChevronRight />
      </button>
    </div>
  );
}

/** Which calendars show, and whether only the market-moving events do. */
export function useFilter() {
  const [hidden, setHidden] = useState<Category[]>([]);
  const [strongOnly, setStrongOnly] = useState(false);
  return {
    hidden,
    strongOnly,
    toggle: (c: Category) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c])),
    setStrongOnly,
    apply: (events: CalendarEvent[]) => events.filter((e) => !hidden.includes(e.category) && (!strongOnly || e.importance === 3)),
  };
}

export type FilterState = ReturnType<typeof useFilter>;

/** The calendars, as Apple lists them: a coloured box per calendar. */
export function CalendarList({ filter, counts }: { filter: FilterState; counts?: Partial<Record<Category, number>> }) {
  return (
    <div className="cl-cals">
      {CATEGORIES.map((c) => {
        const on = !filter.hidden.includes(c);
        return (
          <label key={c} className="cl-cal" style={{ "--tone": CATEGORY_TONE[c] } as CSSProperties}>
            <input type="checkbox" checked={on} onChange={() => filter.toggle(c)} />
            <span className="cl-box" aria-hidden />
            <span className="cl-cal-name">{CATEGORY_LABELS[c]}</span>
            {counts && <span className="cl-cal-count">{counts[c] ?? ""}</span>}
          </label>
        );
      })}
      <label className="cl-cal cl-cal-strong">
        <input type="checkbox" checked={filter.strongOnly} onChange={(e) => filter.setStrongOnly(e.target.checked)} />
        <span className="cl-box" aria-hidden />
        <span className="cl-cal-name">Market-moving only</span>
      </label>
    </div>
  );
}

/** The calendars as a row of chips: the same filter, in little room. */
export function CalendarChips({ filter, counts }: { filter: FilterState; counts: Partial<Record<Category, number>> }) {
  return (
    <div className="cl-chips" role="group" aria-label="Calendars">
      {CATEGORIES.map((c) => {
        const on = !filter.hidden.includes(c);
        return (
          <button key={c} type="button" className={`cl-chip${on ? "" : " is-off"}`} aria-pressed={on} style={{ "--tone": CATEGORY_TONE[c] } as CSSProperties} onClick={() => filter.toggle(c)}>
            <span className="cl-chip-dot" aria-hidden />
            {CATEGORY_LABELS[c]}
            {counts[c] ? <span className="cl-chip-count">{counts[c]}</span> : null}
          </button>
        );
      })}
      <button type="button" className={`cl-chip cl-chip-strong${filter.strongOnly ? "" : " is-off"}`} aria-pressed={filter.strongOnly} onClick={() => filter.setStrongOnly(!filter.strongOnly)}>
        Market-moving only
      </button>
    </div>
  );
}

/** The calendars list, behind a toolbar button. */
export function FilterMenu({ filter }: { filter: FilterState }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const active = filter.hidden.length > 0 || filter.strongOnly;
  return (
    <div className="cl-pop-anchor" ref={root}>
      <button type="button" className={`cl-icon${active ? " is-active" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Calendars">
        <Filter />
      </button>
      {open && (
        <div className="cl-pop cl-pop-end" role="dialog" aria-label="Calendars">
          <CalendarList filter={filter} />
        </div>
      )}
    </div>
  );
}

const longDay = (d: Date) => d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" });

function sourceOf(e: CalendarEvent): ReactNode {
  if (e.computed) return "Computed from the venue's schedule";
  if (!e.url) return e.source;
  return (
    <a href={e.url} target="_blank" rel="noreferrer">
      {e.source}
    </a>
  );
}

/** One event, in full: what the grids leave out. `compact` drops the date
    (the day is already on screen), `facts` keeps only the details (the
    row above already says the time and the title). */
export function EventCard({ event, variant = "full" }: { event: CalendarEvent; variant?: "full" | "compact" | "facts" }) {
  return (
    <article className={`cl-card is-${variant}`} style={tone(event)}>
      {variant !== "facts" && (
        <>
          <h3 className="cl-card-title">{event.title}</h3>
          <p className="cl-card-when">
            {variant === "full" && (
              <>
                {longDay(eventDay(event))}
                <br />
              </>
            )}
            {event.allDay ? "All day" : timeOf(event)}
          </p>
        </>
      )}
      <dl className="cl-card-facts">
        <div>
          <dt>Calendar</dt>
          <dd>
            <span className="cl-swatch" aria-hidden />
            {CATEGORY_LABELS[event.category]}
          </dd>
        </div>
        {event.assets.length > 0 && (
          <div>
            <dt>Assets</dt>
            <dd>{event.assets.join(", ")}</dd>
          </div>
        )}
        {event.importance === 3 && (
          <div>
            <dt>Impact</dt>
            <dd>Market-moving</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>{sourceOf(event)}</dd>
        </div>
      </dl>
    </article>
  );
}
