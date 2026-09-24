import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { tableCard } from "../shared/cards";
import { CATEGORIES, CATEGORY_LABELS, eventLine, type CalendarEvent, type Category, type EventQuery } from "./events";

/* EventSearch: the calendar's entries of a period — market events, the
   user's tasks, the computed expiries and scheduled runs — from the local
   table, no network call. Every entry comes with its id (for CalendarEdit)
   and its source. */

type Args = { from?: string; days?: number; categories?: Category[]; assets?: string[]; watchlist?: boolean; minImportance?: number; text?: string };

const MAX_RESULTS = 50;
const DAY = 24 * 3600_000;

export type Searcher = {
  search(query: EventQuery): Promise<CalendarEvent[]>;
  watchlist(): Promise<string[] | null>;
};

export function eventSearchTool(searcher: Searcher): Tool<Args> {
  return {
    name: "EventSearch",
    policy: { readOnly: true, subagent: true },
    description:
      "Searches the user's calendar: market events (macro, token unlocks, listings, upgrades, project events), the user's tasks, the options and futures expiries and the scheduled tasks' coming runs. " +
      "Filters: a period (`from`, default now, over `days`, default 7, max 90), `categories`, `assets` (or `watchlist: true` for the user's watchlist), `minImportance` (1–3), free `text`. Answers instantly from the table; each entry carries its id (for CalendarEdit) and its source. Only what your agents wrote is there: search the web and add what is missing with CalendarEdit.",
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
      const period = `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
      if (found.length === 0) return ok(`No entry ${period} for these filters.`);
      const shown = found.slice(0, MAX_RESULTS);
      return {
        ...ok([`${found.length} entr${found.length > 1 ? "ies" : "y"}, ${period}${found.length > MAX_RESULTS ? ` (first ${MAX_RESULTS})` : ""}:`, ...shown.map((e) => `- ${eventLine(e)}`)].join("\n")),
        card: tableCard(
          `Calendar · ${period}`,
          ["When", "Entry", "Importance"],
          shown.map((e) => [e.allDay ? e.startsAt.slice(0, 10) : `${e.startsAt.slice(0, 16).replace("T", " ")} UTC`, `${e.title}${e.done ? " ✓" : ""}${e.assets.length ? ` (${e.assets.join(", ")})` : ""} — ${CATEGORY_LABELS[e.category]}`, "●".repeat(e.importance)]),
          { note: "Each entry has its id and its source in the tool's output." },
        ),
      };
    },
  };
}
