"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CATEGORIES, CATEGORY_LABELS, type CalendarEvent, type Category } from "@/lib/plugins/calendar/events";
import { ChevronLeft, ChevronRight, Filter } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { CATEGORY_TONE, eventDay, LOCALE, timeOf } from "./model";

/* The pieces the three calendar designs share: the segmented control, the
   previous / today / next stepper, the calendars filter, and the card of
   one event. */

export const tone = (e: CalendarEvent) => ({ "--tone": CATEGORY_TONE[e.category] }) as CSSProperties;

/** Apple's segmented control; `value` null: no segment is on (the view
    shows something none of them names). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
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

/** The short names a two-column filter has room for. */
const SHORT: Record<Category, string> = {
  macro: "Macro",
  unlock: "Unlocks",
  listing: "Listings",
  expiry: "Expiries",
  upgrade: "Upgrades",
  project: "Projects",
};

/** The calendars under the month: an ordered two-column grid (a colour, a
    name, a count), and the market-moving switch on its own line. */
export function CalendarFilters({ filter, counts }: { filter: FilterState; counts: Partial<Record<Category, number>> }) {
  return (
    <div className="cl-filters">
      <p className="cl-filters-title">Calendars</p>
      <div className="cl-filters-grid" role="group" aria-label="Calendars">
        {CATEGORIES.map((c) => {
          const on = !filter.hidden.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={`cl-filter${on ? "" : " is-off"}`}
              aria-pressed={on}
              title={CATEGORY_LABELS[c]}
              style={{ "--tone": CATEGORY_TONE[c] } as CSSProperties}
              onClick={() => filter.toggle(c)}
            >
              <span className="cl-filter-dot" aria-hidden />
              <span className="cl-filter-name">{SHORT[c]}</span>
              <span className="cl-filter-count">{counts[c] ?? 0}</span>
            </button>
          );
        })}
      </div>
      <label className="cl-filters-strong">
        <span>Market-moving only</span>
        <Switch on={filter.strongOnly} onChange={filter.setStrongOnly} label="Market-moving only" />
      </label>
    </div>
  );
}

/** Closes a popover on a click outside `root` or on Escape. */
function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, close, root]);
}

/** The calendars list, behind a toolbar button. */
export function FilterMenu({ filter }: { filter: FilterState }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
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

const YEARS = 12;

/** The month and the year of the title, each a button: the month opens the
    twelve months, the year twelve years at a time. */
export function MonthTitle({ month, today, onChange }: { month: Date; today: Date; onChange: (month: Date) => void }) {
  const [open, setOpen] = useState<"month" | "year" | null>(null);
  const [first, setFirst] = useState(month.getFullYear() - 5);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(open !== null, close, root);
  const year = month.getFullYear();
  const pick = (d: Date) => {
    onChange(d);
    setOpen(null);
  };

  return (
    <div className="cl-pop-anchor cl-month-title" ref={root}>
      <h1 className="cl-title">
        <button type="button" className={`cl-title-btn${open === "month" ? " is-open" : ""}`} aria-expanded={open === "month"} onClick={() => setOpen(open === "month" ? null : "month")}>
          {month.toLocaleDateString(LOCALE, { month: "long" })}
        </button>{" "}
        <button
          type="button"
          className={`cl-title-btn cl-title-year${open === "year" ? " is-open" : ""}`}
          aria-expanded={open === "year"}
          onClick={() => {
            setFirst(year - 5);
            setOpen(open === "year" ? null : "year");
          }}
        >
          {year}
        </button>
      </h1>
      {open === "month" && (
        <div className="cl-pop cl-picker" role="dialog" aria-label="Months">
          <div className="cl-picker-grid">
            {Array.from({ length: 12 }, (_, i) => new Date(year, i, 1)).map((d) => (
              <button
                key={d.getMonth()}
                type="button"
                className={`cl-picker-item${d.getMonth() === month.getMonth() ? " is-current" : ""}${d.getMonth() === today.getMonth() && year === today.getFullYear() ? " is-today" : ""}`}
                onClick={() => pick(d)}
              >
                {d.toLocaleDateString(LOCALE, { month: "short" })}
              </button>
            ))}
          </div>
        </div>
      )}
      {open === "year" && (
        <div className="cl-pop cl-picker" role="dialog" aria-label="Years">
          <div className="cl-picker-head">
            <button type="button" className="cl-icon is-small" onClick={() => setFirst(first - YEARS)} aria-label="Earlier years">
              <ChevronLeft />
            </button>
            <span>
              {first} – {first + YEARS - 1}
            </span>
            <button type="button" className="cl-icon is-small" onClick={() => setFirst(first + YEARS)} aria-label="Later years">
              <ChevronRight />
            </button>
          </div>
          <div className="cl-picker-grid">
            {Array.from({ length: YEARS }, (_, i) => first + i).map((y) => (
              <button key={y} type="button" className={`cl-picker-item${y === year ? " is-current" : ""}${y === today.getFullYear() ? " is-today" : ""}`} onClick={() => pick(new Date(y, month.getMonth(), 1))}>
                {y}
              </button>
            ))}
          </div>
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
