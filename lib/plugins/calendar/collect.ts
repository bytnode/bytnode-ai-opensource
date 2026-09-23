import { mergeEvents, validateEvent, type CalendarEvent } from "./events";

/* ---------------------------------------------------------------------------
   The collection of events by an agent, in the background.

   There is no events API: an agent of the user's searches the web
   (WebSearch goes through the model's provider), and hands back a JSON
   list. What it hands back is DATA, checked field by field — an event
   without a source URL is rejected — then merged without duplicates.
   Expiries are not collected: they are computed (`expiries.ts`). Pure,
   tested.
--------------------------------------------------------------------------- */

export function collectorPrompt(from: Date, to: Date, focus: string[]): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return [
    `Collect the crypto-market events scheduled between ${day(from)} and ${day(to)} (UTC):`,
    "- macro: central-bank decisions and speeches, inflation (CPI, PCE), employment (NFP), GDP;",
    "- unlock: token unlocks and large vesting releases;",
    "- listing: exchange listings and delistings;",
    "- upgrade: protocol upgrades, hard forks, mainnet launches;",
    "- project: other dated project events (governance votes, burns, major launches).",
    "Leave out options and futures expiries: they are computed elsewhere.",
    focus.length ? `Look in particular for events concerning: ${focus.join(", ")}.` : "",
    "",
    "Search with WebSearch, and open a page with WebFetch when a date or a time needs checking. Every event needs the URL of a page that announces it: skip anything you cannot source. Never guess a date.",
    "",
    "End your answer with ONE JSON array, in a ```json block, and nothing after it:",
    "```json",
    '[{"startsAt": "2026-10-29T18:00:00Z", "allDay": false, "category": "macro", "title": "FOMC rate decision", "assets": [], "importance": 3, "source": "Federal Reserve", "url": "https://www.federalreserve.gov/…", "id": "optional id given by the source"}]',
    "```",
    "`startsAt` in UTC (for a date without a time: that day at 00:00Z with `allDay: true`); `assets`: the base symbols concerned (BTC, ETH…), empty for the whole market; `importance`: 3 = expected market impact (FOMC, CPI, a large unlock), 2 = notable, 1 = minor.",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/** The JSON list at the end of the agent's answer. */
export function parseCollected(text: string): unknown[] | { error: string } {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)];
  for (const c of candidates) {
    try {
      const value: unknown = JSON.parse(c.trim());
      if (Array.isArray(value)) return value;
    } catch {
      /* the next candidate */
    }
  }
  return { error: "The collector's answer holds no JSON list of events." };
}

export type Collected = { events: CalendarEvent[]; added: number; updated: number; rejected: string[] };

/** The collected list into the table: checked, merged, pruned. */
export function absorb(stored: CalendarEvent[], raw: unknown[], now: Date): Collected {
  const valid: CalendarEvent[] = [];
  const rejected: string[] = [];
  for (const r of raw) {
    const e = validateEvent(r, now);
    if ("error" in e) rejected.push(e.error);
    else if (e.category !== "expiry") valid.push(e);
    else rejected.push(`expiries are computed, not collected: "${e.title}"`);
  }
  return { ...mergeEvents(stored, valid, now), rejected };
}
