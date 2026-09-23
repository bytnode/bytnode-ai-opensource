import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { tableCard } from "../shared/cards";
import { CATEGORIES, CATEGORY_LABELS, eventLine, type CalendarEvent, type Category, type EventQuery } from "./events";

/* EventSearch: the market events of a period, from the local table — no
   network call. Every event comes with its source and collection date. */

type Args = { from?: string; days?: number; categories?: Category[]; assets?: string[]; watchlist?: boolean; minImportance?: number; text?: string };

const MAX_RESULTS = 50;
const DAY = 24 * 3600_000;

export type Searcher = {
  search(query: EventQuery): Promise<CalendarEvent[]>;
  watchlist(): Promise<string[] | null>;
  lastCollection(): Promise<string | null>;
};

export function eventSearchTool(searcher: Searcher): Tool<Args> {
  return {
    name: "EventSearch",
    policy: { readOnly: true, subagent: true },
    description:
      "Searches the local table of market events: macro (central banks, CPI, jobs), token unlocks, listings, options and futures expiries, upgrades, project events. " +
      "Filters: a period (`from`, default now, over `days`, default 7, max 90), `categories`, `assets` (or `watchlist: true` for the user's watchlist), `minImportance` (1–3), free `text`. Answers instantly from the table; each event carries its source URL and its collection date.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, ISO (default: now)." },
        days: { type: "integer", minimum: 1, maximum: 90, description: "Length of the period, in days (default 7)." },
        categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
        assets: { type: "array", items: { type: "string" }, description: "Base assets: BTC, ETH… Events of the whole market are included." },
        watchlist: { type: "boolean", description: "Only the assets of the user's watchlist (and the whole market)." },
        minImportance: { type: "integer", minimum: 1, maximum: 3, description: "3 = expected market impact." },
        text: { type: "string", description: "Words in the title." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const from = args.from ? new Date(args.from) : new Date();
      if (!Number.isFinite(from.getTime())) return fail(`Not a date: ${args.from}.`);
      const to = new Date(from.getTime() + (args.days ?? 7) * DAY);
      let assets = args.assets;
      if (args.watchlist) {
        const list = await searcher.watchlist();
        if (!list) return fail("The watchlist plugin is off: give `assets` instead.");
        assets = [...(assets ?? []), ...list];
      }
      const found = await searcher.search({ from, to, categories: args.categories, assets, minImportance: args.minImportance, text: args.text });
      const last = await searcher.lastCollection();
      const period = `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
      const collected = last ? `Last collection: ${last.slice(0, 16).replace("T", " ")} UTC.` : "No collection yet: only the computed expiries are known (EventRefresh starts one).";
      if (found.length === 0) return ok(`No event ${period} for these filters. ${collected}`);
      const shown = found.slice(0, MAX_RESULTS);
      return {
        ...ok([`${found.length} event${found.length > 1 ? "s" : ""}, ${period}${found.length > MAX_RESULTS ? ` (first ${MAX_RESULTS})` : ""}:`, ...shown.map((e) => `- ${eventLine(e)}`), collected].join("\n")),
        card: tableCard(
          `Market events · ${period}`,
          ["When", "Event", "Importance"],
          shown.map((e) => [e.allDay ? e.startsAt.slice(0, 10) : `${e.startsAt.slice(0, 16).replace("T", " ")} UTC`, `${e.title}${e.assets.length ? ` (${e.assets.join(", ")})` : ""} — ${CATEGORY_LABELS[e.category]}`, "●".repeat(e.importance)]),
          { note: "Each event has its source in the tool's output." },
        ),
      };
    },
  };
}
