import { afterEach, describe, expect, it } from "vitest";
import { definePlugin, type ApiRequest } from "../core/contract";
import { pluginStore } from "../core/store";
import { manifest } from "../core/test-fixture";
import type { PlannedRun, SchedulerService } from "../scheduler/service";
import { harness, type Harness } from "../test-fixture";
import type { CalendarEvent } from "./events";
import type { CalendarService } from "./service";
import { calendarPlugin } from ".";

/* A scheduler that only tells its plan: one task, tomorrow morning. */
const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const brief: PlannedRun = { taskId: "t1", title: "Morning brief", agent: "Analyst", frequency: "daily at 08:00", at: soon(20), allDay: false };
const scheduler = definePlugin({
  manifest: manifest("scheduler"),
  setup(ctx) {
    ctx.provide<SchedulerService>(() => ({
      job: () => undefined,
      trigger: async () => undefined,
      runAgent: async () => ({ ok: false, error: "not in tests" }),
      planned: async (from, to) => [brief].filter((r) => Date.parse(r.at) >= from.getTime() && Date.parse(r.at) <= to.getTime()),
    }));
  },
});

const fomc = { startsAt: soon(20), category: "macro", title: "FOMC rate decision", assets: [], importance: 3, source: "Federal Reserve", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" };
const review = { startsAt: soon(5), category: "task", title: "Review the BTC position", assets: ["BTC"], notes: "Before the Fed" };

let h: Harness;
afterEach(async () => h?.close());

/* A view's action, as `POST /api/plugins/calendar/<action>` runs it. */
const api = (action: string, params: Record<string, unknown>) => h.runtime.handler("calendar", action)!(params, {} as ApiRequest);

describe("calendar plugin", () => {
  it("fetches nothing by itself: no job, no collection tool", async () => {
    h = await harness([calendarPlugin]);
    expect(h.runtime.tools(null).map((t) => t.name).sort()).toEqual(["CalendarEdit", "EventSearch"]);
    expect(h.tool("CalendarEdit").policy).toMatchObject({ readOnly: false, gated: false, subagent: true });
  });

  it("an agent writes events and tasks; the rejected ones say why", async () => {
    h = await harness([calendarPlugin]);
    const edit = h.tool("CalendarEdit");
    const r = await edit.execute({ add: [fomc, review, { ...fomc, title: "Rumoured listing", category: "listing", url: "" }] }, { ...h.ctx(), agentId: "a1" });
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/^Added 2:\n- .*FOMC rate decision.*\n- .*Review the BTC position \[BTC\] · Task · source: an agent \(id [0-9a-f]{16}, written/);
    expect(r.output).toMatch(/Rejected: no source URL: "Rumoured listing"\.$/);
    const stored = await pluginStore("calendar", h.root).read<CalendarEvent[]>("events.json", []);
    expect(stored.map((e) => [e.title, e.by])).toEqual([
      ["Review the BTC position", "a1"],
      ["FOMC rate decision", "a1"],
    ]);
    expect(await edit.execute({}, h.ctx())).toMatchObject({ ok: false, output: "Give `add`, `update` or `remove`." });
    expect(await edit.execute({ remove: ["nope"] }, h.ctx())).toMatchObject({ ok: false, output: 'Rejected: no entry "nope" to remove.' });
  });

  it("finds entries with their ids, ticks a task off, and the view deletes", async () => {
    h = await harness([calendarPlugin]);
    await h.tool("CalendarEdit").execute({ add: [review] }, h.ctx());
    const found = await h.tool("EventSearch").execute({ categories: ["task"] }, h.ctx());
    const id = /\(id ([0-9a-f]{16}),/.exec(found.output)![1];
    expect((await h.tool("CalendarEdit").execute({ update: [{ id, done: true }] }, h.ctx())).output).toMatch(/^Updated 1:\n- .*Review the BTC position \(done\)/);
    expect(await api("remove", { id })).toEqual({ removed: id });
    await expect(api("remove", { id })).rejects.toThrow("This entry is no longer in the calendar.");
    expect((await h.tool("EventSearch").execute({ categories: ["task"] }, h.ctx())).output).toMatch(/^No entry /);
  });

  it("shows the scheduled tasks' runs, tells the agents what is coming, serves the alerts", async () => {
    let service: CalendarService | undefined;
    const alerts = definePlugin({
      manifest: manifest("alerts", [], ["calendar"]),
      setup(ctx) {
        service = ctx.optional<CalendarService>("calendar");
      },
    });
    h = await harness([scheduler, calendarPlugin, alerts]);
    await h.tool("CalendarEdit").execute({ add: [fomc, review, { ...fomc, title: "ARB unlock", category: "unlock", assets: ["ARB"], importance: 2, startsAt: soon(5), url: "https://token.unlocks.app/arbitrum" }] }, h.ctx());

    const week = (await api("week", { days: 2 })) as { events: CalendarEvent[] };
    expect(week.events.find((e) => e.category === "scheduled")).toMatchObject({ title: "Morning brief", computed: true, source: "Scheduled task — agent Analyst, daily at 08:00" });
    expect((await h.tool("EventSearch").execute({ days: 2, categories: ["scheduled"] }, h.ctx())).output).toMatch(/Morning brief · Scheduled task · source: Scheduled task — agent Analyst, daily at 08:00 \(computed, not editable\)/);

    const prompt = await h.runtime.prompts(["calendar"], { agentId: "a1", engine: "native", subagent: false }, {});
    /* A computed quarterly expiry may come first, depending on the day. */
    expect(prompt[0]).toMatch(/^## Market events in the next 48 hours\n/);
    expect(prompt[0]).toContain("FOMC rate decision");
    expect(prompt[0]).not.toContain("ARB unlock");
    expect(prompt[0]).toMatch(/## The user's tasks in the next 48 hours\n- .*Review the BTC position/);
    expect((await service!.upcoming({ assets: ["ARB"], withinHours: 10, minImportance: 2 })).map((e) => e.title)).toEqual(["ARB unlock"]);
  });
});
