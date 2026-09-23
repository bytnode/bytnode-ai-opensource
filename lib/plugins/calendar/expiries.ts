import type { CalendarEvent } from "./events";

/* ---------------------------------------------------------------------------
   Options and futures expiries, computed from the venues' schedules rather
   than collected: they follow a rule.

   - Deribit (BTC, ETH options and futures): every Friday at 08:00 UTC; the
     last Friday of the month is the monthly expiry, and of March, June,
     September and December the quarterly one — the big ones.
   - CME (Bitcoin and Ether futures): the last Friday of the month,
     settled at 4 pm London time.

   A holiday can move an expiry: the venue's own calendar has the last
   word, and every computed event says it is computed. Pure, tested.
--------------------------------------------------------------------------- */

const DAY = 24 * 3600_000;
const QUARTERS = [2, 5, 8, 11];

const lastFriday = (year: number, month: number): number => {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - ((last.getUTCDay() - 5 + 7) % 7);
};

export function expiries(from: Date, to: Date, now: Date): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const fetchedAt = now.toISOString();
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let t = start.getTime(); t <= to.getTime(); t += DAY) {
    const d = new Date(t);
    if (d.getUTCDay() !== 5) continue;
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    const monthly = day === lastFriday(year, month);
    const quarterly = monthly && QUARTERS.includes(month);
    const at = new Date(Date.UTC(year, month, day, 8));
    const date = at.toISOString().slice(0, 10);
    if (at >= from && at <= to) {
      out.push({
        id: `deribit-${date}`,
        startsAt: at.toISOString(),
        allDay: false,
        category: "expiry",
        title: `Deribit BTC & ETH ${quarterly ? "quarterly" : monthly ? "monthly" : "weekly"} options and futures expiry`,
        assets: ["BTC", "ETH"],
        importance: quarterly ? 3 : monthly ? 2 : 1,
        source: "Deribit schedule (computed: Fridays 08:00 UTC)",
        url: "https://www.deribit.com",
        fetchedAt,
        computed: true,
      });
    }
    if (monthly) {
      out.push({
        id: `cme-${date.slice(0, 7)}`,
        startsAt: `${date}T00:00:00.000Z`,
        allDay: true,
        category: "expiry",
        title: "CME Bitcoin & Ether futures expiry (4 pm London)",
        assets: ["BTC", "ETH"],
        importance: quarterly ? 3 : 2,
        source: "CME schedule (computed: last Friday of the month)",
        url: "https://www.cmegroup.com",
        fetchedAt,
        computed: true,
      });
    }
  }
  return out;
}
