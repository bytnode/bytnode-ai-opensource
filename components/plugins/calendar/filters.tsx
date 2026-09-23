"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type CalendarEvent, type Category } from "@/lib/plugins/calendar/events";
import { Switch } from "@/components/ui/switch";
import { toneOf } from "./format";

/* The calendars as filters, in two aligned columns — a colour, a short
   name, the count of the month on screen — and two switches: only the
   market-moving events, only the watchlist's assets. */

const SHORT: Record<Category, string> = {
  macro: "Macro",
  unlock: "Unlocks",
  listing: "Listings",
  expiry: "Expiries",
  upgrade: "Upgrades",
  project: "Projects",
};

export function useFilter() {
  const [hidden, setHidden] = useState<Category[]>([]);
  const [strongOnly, setStrongOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  return {
    hidden,
    strongOnly,
    watchlistOnly,
    toggle: (c: Category) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c])),
    setStrongOnly,
    setWatchlistOnly,
    apply: (events: CalendarEvent[]) => events.filter((e) => !hidden.includes(e.category) && (!strongOnly || e.importance === 3)),
  };
}

export type FilterState = ReturnType<typeof useFilter>;

export function CalendarFilters({ filter, counts, watchlist }: { filter: FilterState; counts: Partial<Record<Category, number>>; watchlist: boolean }) {
  return (
    <div className="calv-filters">
      <p className="calv-filters-title">Calendars</p>
      <div className="calv-filters-grid" role="group" aria-label="Calendars">
        {CATEGORIES.map((c) => {
          const on = !filter.hidden.includes(c);
          return (
            <button key={c} type="button" className={`calv-filter${on ? "" : " is-off"}`} aria-pressed={on} title={CATEGORY_LABELS[c]} style={toneOf(c)} onClick={() => filter.toggle(c)}>
              <span className="calv-filter-dot" aria-hidden />
              <span className="calv-filter-name">{SHORT[c]}</span>
              <span className="calv-filter-count">{counts[c] ?? 0}</span>
            </button>
          );
        })}
      </div>
      <div className="calv-switches">
        <label className="calv-switch">
          <span>Market-moving only</span>
          <Switch on={filter.strongOnly} onChange={filter.setStrongOnly} label="Market-moving only" />
        </label>
        {watchlist && (
          <label className="calv-switch">
            <span>My watchlist only</span>
            <Switch on={filter.watchlistOnly} onChange={filter.setWatchlistOnly} label="My watchlist only" />
          </label>
        )}
      </div>
    </div>
  );
}
