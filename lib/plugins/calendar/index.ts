import { definePlugin, type Session } from "../core/contract";
import type { SchedulerService } from "../scheduler/service";
import { baseOf } from "../shared/quote";
import type { WatchlistService } from "../watchlist/service";
import { absorb, collectorPrompt, parseCollected } from "./collect";
import { eventRefreshTool } from "./event-refresh";
import { eventSearchTool } from "./event-search";
import { calendarPrompt, searchEvents, type CalendarEvent, type Category, type EventQuery } from "./events";
import { expiries } from "./expiries";
import { calendarManifest } from "./manifest";
import type { CalendarService } from "./service";

/* The market calendar: the stored events (collected by an agent, in two
   background jobs) and the computed expiries, searched together by the
   tools, the prompt, the alerts and the week view. */

const EVENTS = "events.json";
const LAST = "collection.json";
const DAY = 24 * 3600_000;

type LastCollection = { at: string; days: number; added: number; updated: number; rejected: string[] };

export const calendarPlugin = definePlugin({
  manifest: calendarManifest,
  setup(ctx) {
    const scheduler = ctx.inject<SchedulerService>("scheduler");
    const watchlist = async () => {
      const service = ctx.optional<WatchlistService>("watchlist");
      return service ? (await service.symbols()).map(baseOf) : null;
    };
    /* Collected and computed, searched as one table. */
    const search = async (q: EventQuery) => searchEvents([...(await ctx.store.read<CalendarEvent[]>(EVENTS, [])), ...expiries(q.from, q.to, new Date())], q);
    const last = () => ctx.store.read<LastCollection | null>(LAST, null);

    const collect = async (days: number, session: Session, signal: AbortSignal) => {
      const agentId = String(ctx.config().agent) || session.agents[0]?.id;
      if (!agentId) throw new Error("No agent to collect the events: create one first.");
      const from = new Date();
      const to = new Date(from.getTime() + days * DAY);
      const run = await scheduler.runAgent({ agentId, prompt: collectorPrompt(from, to, (await watchlist()) ?? []), purpose: `market calendar collection, next ${days} days`, signal });
      if (!run.ok) throw new Error(run.error);
      const raw = parseCollected(run.text);
      if ("error" in raw) throw new Error(raw.error);
      let summary: LastCollection = { at: "", days, added: 0, updated: 0, rejected: [] };
      await ctx.store.update<CalendarEvent[]>(EVENTS, [], (stored) => {
        const r = absorb(stored, raw, new Date());
        summary = { at: new Date().toISOString(), days, added: r.added, updated: r.updated, rejected: r.rejected.slice(0, 20) };
        return r.events;
      });
      await ctx.store.write(LAST, summary);
      return `${summary.added} new, ${summary.updated} updated, ${summary.rejected.length} rejected.`;
    };
    scheduler.job({ id: "daily", title: "Calendar: the next 7 days", every: String(ctx.config().daily), catchUp: "run-once-on-start", run: ({ session, signal }) => collect(7, session, signal) });
    scheduler.job({ id: "weekly", title: "Calendar: the next 30 days", every: String(ctx.config().weekly), catchUp: "run-once-on-start", run: ({ session, signal }) => collect(30, session, signal) });
    const refresh = (days: 7 | 30) => scheduler.trigger(days === 30 ? "weekly" : "daily");

    ctx.tool(eventSearchTool({ search, watchlist, lastCollection: async () => (await last())?.at ?? null }));
    ctx.tool(eventRefreshTool(refresh));
    ctx.prompt(async () => {
      const now = new Date();
      return calendarPrompt(await search({ from: now, to: new Date(now.getTime() + 2 * DAY), minImportance: 3 }), now);
    });
    ctx.provide<CalendarService>(() => ({
      upcoming: ({ assets, withinHours, minImportance }) => {
        const now = new Date();
        return search({ from: now, to: new Date(now.getTime() + withinHours * 3600_000), assets, minImportance });
      },
    }));

    /* --- The view ---------------------------------------------------------- */

    ctx.api("week", async (params) => {
      const from = typeof params.from === "string" && Number.isFinite(Date.parse(params.from)) ? new Date(params.from) : new Date();
      const mine = params.watchlist === true ? await watchlist() : null;
      const categories = Array.isArray(params.categories) ? (params.categories.filter((c) => typeof c === "string") as Category[]) : undefined;
      const minImportance = typeof params.minImportance === "number" ? params.minImportance : undefined;
      return {
        events: await search({ from, to: new Date(from.getTime() + 7 * DAY), categories, minImportance, assets: mine ?? undefined }),
        last: await last(),
        watchlist: (await watchlist()) !== null,
      };
    });
    ctx.api("refresh", async (params) => {
      await refresh(params.days === 30 ? 30 : 7);
      return { requested: true };
    });
  },
});
