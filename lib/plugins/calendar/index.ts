import { definePlugin } from "../core/contract";
import type { SchedulerService } from "../scheduler/service";
import { baseOf } from "../shared/quote";
import type { WatchlistService } from "../watchlist/service";
import { calendarEditTool } from "./calendar-edit";
import { editCalendar, type Author, type Edit } from "./edit";
import { eventSearchTool } from "./event-search";
import { calendarPrompt, searchEvents, type CalendarEvent, type Category, type EventQuery } from "./events";
import { expiries } from "./expiries";
import { calendarManifest } from "./manifest";
import type { CalendarService } from "./service";

/* The calendar: what the user's agents write in it (`CalendarEdit`), the
   computed expiries and the scheduled tasks' coming runs (when the
   scheduler is on), searched together by the tools, the prompt, the
   alerts and the view. Nothing fills it behind the user's back: an agent
   writes when it is asked to, or when a scheduled task tells it to. */

const EVENTS = "events.json";
const DAY = 24 * 3600_000;
const MAX_VIEW_DAYS = 62;

export const calendarPlugin = definePlugin({
  manifest: calendarManifest,
  setup(ctx) {
    const watchlist = async () => {
      const service = ctx.optional<WatchlistService>("watchlist");
      return service ? (await service.symbols()).map(baseOf) : null;
    };
    /* The coming runs of the agent tasks, as calendar entries. */
    const planned = async (from: Date, to: Date): Promise<CalendarEvent[]> => {
      const scheduler = ctx.optional<SchedulerService>("scheduler");
      if (!scheduler) return [];
      const fetchedAt = new Date().toISOString();
      return (await scheduler.planned(from, to)).map((r) => ({
        id: `scheduled-${r.taskId}-${r.at}`,
        startsAt: r.at,
        allDay: r.allDay,
        category: "scheduled",
        title: r.title,
        assets: [],
        importance: 1,
        source: `Scheduled task — agent ${r.agent}, ${r.frequency}`,
        url: "",
        fetchedAt,
        computed: true,
      }));
    };
    /* Written, computed and planned, searched as one table. */
    const search = async (q: EventQuery) => searchEvents([...(await ctx.store.read<CalendarEvent[]>(EVENTS, [])), ...expiries(q.from, q.to, new Date()), ...(await planned(q.from, q.to))], q);
    const edit = async (change: Edit, author: Author) => {
      let result = editCalendar([], {}, new Date(), author);
      await ctx.store.update<CalendarEvent[]>(EVENTS, [], (stored) => {
        result = editCalendar(stored, change, new Date(), author);
        return result.events;
      });
      if (result.added.length || result.updated.length || result.removed.length) ctx.emit("changed", {});
      return result;
    };
    /* A task's source is the agent that wrote it — named when the session
       is at hand (the Next server; a subscription agent's MCP server only
       knows the id, which the view names). */
    const author = (agentId?: string): Author => ({ name: ctx.session()?.agents.find((a) => a.id === agentId)?.name.trim() || "an agent", agentId: agentId || undefined });

    ctx.tool(eventSearchTool({ search, watchlist }));
    ctx.tool(calendarEditTool((change, tctx) => edit(change, author(tctx.agentId))));
    ctx.prompt(async () => {
      const now = new Date();
      return calendarPrompt(await search({ from: now, to: new Date(now.getTime() + 2 * DAY) }), now);
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
      /* A week by default; a month view asks for its six weeks. */
      const days = typeof params.days === "number" ? Math.min(Math.max(Math.round(params.days), 1), MAX_VIEW_DAYS) : 7;
      return {
        events: await search({ from, to: new Date(from.getTime() + days * DAY), categories, minImportance, assets: mine ?? undefined }),
        watchlist: (await watchlist()) !== null,
      };
    });
    /* The user adds an entry from an hour of the agenda: a title, a
       calendar, a description — no source asked, it is theirs. */
    ctx.api("add", async (params) => {
      const entry = { startsAt: params.startsAt, allDay: params.allDay === true, category: params.category, title: params.title, notes: params.notes };
      const r = await edit({ add: [entry] }, { name: "You", user: true });
      if (r.rejected.length) throw new Error(r.rejected[0]);
      return { added: r.added[0]?.id ?? r.updated[0]?.id };
    });
    /* The user deletes an entry from its details. */
    ctx.api("remove", async (params) => {
      if (typeof params.id !== "string") throw new Error("Expected `id`.");
      const r = await edit({ remove: [params.id] }, { name: "you" });
      if (!r.removed.length) throw new Error("This entry is no longer in the calendar.");
      return { removed: params.id };
    });
  },
});
