"use client";

import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { callPlugin } from "@/lib/plugins/client";
import { DAY, sampleEvents } from "./model";

/* The events of a date range: the review's sample, or the calendar
   plugin's table (collected events and computed expiries). */

export type Source = "sample" | "live";

type Loaded = { key: string; events?: CalendarEvent[]; error?: string };

export function useCalendarEvents(source: Source, from: Date, days: number, today: Date) {
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ key: "" });
  const start = from.getTime();
  const key = `${start}|${days}|${round}`;

  useEffect(() => {
    if (source !== "live") return;
    let alive = true;
    callPlugin<{ events: CalendarEvent[] }>("calendar", "week", { from: new Date(start).toISOString(), days }).then(
      (r) => alive && setLoaded({ key, events: r.events }),
      (e: Error) => alive && setLoaded({ key, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [source, start, days, key]);

  const sample = useMemo(() => sampleEvents(today), [today]);
  const end = start + days * DAY;
  const inRange = (list: CalendarEvent[]) =>
    list.filter((e) => {
      const t = Date.parse(e.startsAt);
      return t >= start - DAY && t < end;
    });

  if (source === "sample") return { events: inRange(sample), loading: false, error: undefined, reload: () => {} };
  return {
    events: inRange(loaded.events ?? []),
    loading: loaded.key !== key,
    error: loaded.key === key ? loaded.error : undefined,
    reload: () => setRound((r) => r + 1),
  };
}
