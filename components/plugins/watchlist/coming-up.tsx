"use client";

import type { CSSProperties } from "react";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { openView } from "@/lib/state/tabs";
import { ChevronRight } from "@/components/ui/icons";
import { TONE } from "../calendar/format";
import { useMessages } from "@/lib/i18n/react";
import { dateTag } from "@/lib/i18n/store";

/* What is coming for the asset, from the Calendar plugin's own events
   (no BytNode call): its next ones — unlocks, listings, upgrades, expiries
   — and the market-moving whole-market ones (a Fed decision moves every
   asset), each as the calendar draws a block: its calendar's colour on the
   left edge. A click opens the Calendar tab on that day. */

export const COMING_DAYS = 30;
const SHOWN = 4;

/** The asset's events and the market-moving whole-market ones, soonest
    first, from now on. */
export function comingFor(events: CalendarEvent[], base: string, now: number): CalendarEvent[] {
  return events
    .filter((e) => Date.parse(e.startsAt) >= now - (e.allDay ? 86_400_000 : 0))
    .filter((e) => e.assets.map((a) => a.toUpperCase()).includes(base) || (e.assets.length === 0 && e.importance === 3))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Opens the Calendar tab, on a day when there is one; `at` makes each
    click a new request, even for the day already asked. */
function open(day?: string) {
  openView("calendar", day ? { day, at: Date.now() } : undefined);
}

export function ComingUp({ events, base }: { events: CalendarEvent[]; base: string }) {
  const m = useMessages();
  const t = m.watchlist.coming;
  const shown = events.slice(0, SHOWN);
  if (!shown.length) return <p className="wlv-insight-message">{t.nothing(base, COMING_DAYS)}</p>;
  return (
    <div className="wlv-events">
      {shown.map((e) => {
        const d = new Date(e.startsAt);
        const when = `${d.toLocaleDateString(dateTag(), { weekday: "short", day: "numeric", month: "short" })}${e.allDay ? "" : ` · ${d.toLocaleTimeString(dateTag(), { hour: "2-digit", minute: "2-digit" })}`}`;
        return (
          <button key={e.id} type="button" className={`wlv-event${e.importance === 3 ? " is-strong" : ""}`} style={{ "--tone": TONE[e.category] } as CSSProperties} onClick={() => open(e.startsAt)} title={t.openDay}>
            <span className="wlv-event-when">{when}</span>
            <span className="wlv-event-title">{e.title}</span>
            <span className="wlv-event-kind">{e.assets.length ? m.calendar.categories[e.category] : t.market}</span>
            <ChevronRight />
          </button>
        );
      })}
      {events.length > SHOWN && (
        <button type="button" className="wlv-event-more" onClick={() => open()}>
          {t.more(events.length - SHOWN)}
          <ChevronRight />
        </button>
      )}
    </div>
  );
}
