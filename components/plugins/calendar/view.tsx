"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type CalendarEvent, type Category } from "@/lib/plugins/calendar/events";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, ArrowRight, Refresh } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { Loading, Problem } from "../bits";

/* ---------------------------------------------------------------------------
   The Calendar tab: a week of market events, day by day, in local time —
   filtered by category, importance and the watchlist — each with its
   source. "Collect now" asks the background collection to run.
--------------------------------------------------------------------------- */

type Week = {
  events: CalendarEvent[];
  last: { at: string; days: number; added: number; updated: number; rejected: string[] } | null;
  watchlist: boolean;
};

const DAY = 24 * 3600_000;
const IMPORTANCE = { 1: "Minor", 2: "Notable", 3: "Market-moving" } as const;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function CalendarView({ settings }: ViewProps) {
  const [offset, setOffset] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [minImportance, setMinImportance] = useState("1");
  const [mine, setMine] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /* The week starts today (at midnight), then moves by whole weeks. */
  const [today] = useState(() => startOfDay(new Date()).getTime());
  const from = new Date(today + offset * 7 * DAY);
  const { data, error, loading, reload } = usePluginData<Week>("calendar", "week", settings, {
    from: from.toISOString(),
    categories,
    minImportance: Number(minImportance),
    watchlist: mine,
  });

  const toggle = (c: Category) => setCategories((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  const collect = async () => {
    const p = await act("calendar", "refresh", { days: 7 }, settings);
    setProblem(p);
    setNotice(p ? null : "Collection requested: the events arrive in a few minutes, while the app is open.");
    reload();
  };

  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY));
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of data?.events ?? []) {
    const d = e.allDay ? new Date(`${e.startsAt.slice(0, 10)}T00:00:00`) : new Date(e.startsAt);
    const k = dayKey(d);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const range = `${days[0].toLocaleDateString([], { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <>
      <div className="pv-toolbar cv-toolbar">
        <button type="button" className="st-icon" onClick={() => setOffset(offset - 1)} aria-label="Previous week" title="Previous week">
          <ArrowLeft />
        </button>
        <strong className="cv-range">{range}</strong>
        <button type="button" className="st-icon" onClick={() => setOffset(offset + 1)} aria-label="Next week" title="Next week">
          <ArrowRight />
        </button>
        {offset !== 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOffset(0)}>
            This week
          </button>
        )}
        {loading && data && <span className="pv-chip">Updating…</span>}
        <span className="tb-space" />
        <button type="button" className="btn btn-sm" onClick={() => void collect()}>
          <Refresh />
          Collect now
        </button>
      </div>
      <div className="cv-filters">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`cv-filter${categories.includes(c) ? " is-on" : ""}`} aria-pressed={categories.includes(c)} onClick={() => toggle(c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
        <div className="pv-toolbar-field">
          <Select
            id="cv-importance"
            label="Importance"
            value={minImportance}
            options={[
              { value: "1", label: "All events" },
              { value: "2", label: "Notable and up" },
              { value: "3", label: "Market-moving" },
            ]}
            onChange={setMinImportance}
          />
        </div>
        {data?.watchlist && (
          <span className="cv-switch">
            <Switch on={mine} onChange={setMine} label="Only my watchlist" />
            My watchlist
          </span>
        )}
      </div>
      <p className="pv-note">
        {data?.last
          ? `Last collection ${new Date(data.last.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}, next ${data.last.days} days: ${data.last.added} new, ${data.last.updated} updated, ${data.last.rejected.length} rejected (no source, no date).`
          : "No collection yet: only the computed expiries are shown. Collect now, or wait for the daily collection."}{" "}
        Expiries are computed from the venues&apos; schedules; a holiday can move them.
      </p>
      {notice && <p className="pv-note">{notice}</p>}
      {problem && <Problem message={problem} />}
      {error && <Problem message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <div className="cv-days">
          {days.map((d) => {
            const events = byDay.get(dayKey(d)) ?? [];
            return (
              <section key={d.getTime()} className="cv-day">
                <h2 className="cv-day-title">{d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h2>
                {events.length === 0 ? (
                  <p className="pv-note">Nothing scheduled.</p>
                ) : (
                  <ul className="cv-events">
                    {events.map((e) => (
                      <li key={e.id} className={`cv-event is-${e.importance}`}>
                        <span className="cv-time">{e.allDay ? "All day" : new Date(e.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="cv-what">
                          <strong>{e.title}</strong>
                          <span className="pv-muted">
                            {CATEGORY_LABELS[e.category]}
                            {e.assets.length > 0 && ` · ${e.assets.join(", ")}`} ·{" "}
                            <a href={e.url} target="_blank" rel="noreferrer">
                              {e.source}
                            </a>
                          </span>
                        </span>
                        <span className={`pv-chip${e.importance === 3 ? " is-strong" : ""}`} title={`Importance ${e.importance} of 3`}>
                          {IMPORTANCE[e.importance]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
