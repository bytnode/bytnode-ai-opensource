import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { definePlugin, type Session } from "../core/contract";
import { pluginStore } from "../core/store";
import { manifest } from "../core/test-fixture";
import type { AgentRunInput, JobSpec, SchedulerService } from "../scheduler/service";
import { harness, type Harness } from "../test-fixture";
import type { CalendarEvent } from "./events";
import type { CalendarService } from "./service";
import { calendarPlugin } from ".";

/* A scheduler that runs nothing by itself: the test runs the jobs. */
const jobs = new Map<string, JobSpec>();
const triggered: string[] = [];
const runAgent = vi.fn<(input: AgentRunInput) => ReturnType<SchedulerService["runAgent"]>>();
const scheduler = definePlugin({
  manifest: manifest("scheduler"),
  setup(ctx) {
    ctx.provide<SchedulerService>((caller) => ({
      job: (spec) => void jobs.set(`${caller.id}:${spec.id}`, spec),
      trigger: async (id) => void triggered.push(`${caller.id}:${id}`),
      runAgent: (input) => runAgent(input),
    }));
  },
});

const SESSION = { agents: [{ id: "a1", name: "Analyst" }] as AgentConfig[] } as Session;
const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const answer = (events: unknown[]) => ({ ok: true as const, text: `Here is what I found.\n\`\`\`json\n${JSON.stringify(events)}\n\`\`\`` });
const fomc = { startsAt: soon(20), category: "macro", title: "FOMC rate decision", assets: [], importance: 3, source: "Federal Reserve", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" };

let h: Harness;
beforeEach(() => {
  jobs.clear();
  triggered.length = 0;
  runAgent.mockReset();
});
afterEach(async () => h?.close());

const runJob = (id: string) => jobs.get(`calendar:${id}`)!.run({ session: SESSION, signal: new AbortController().signal, reason: "manual" });

describe("calendar plugin", () => {
  it("collects through an agent, keeps what is sourced, never duplicates", async () => {
    h = await harness([scheduler, calendarPlugin]);
    expect([...jobs.keys()]).toEqual(["calendar:daily", "calendar:weekly"]);
    expect(jobs.get("calendar:daily")).toMatchObject({ every: "daily at 07:00", catchUp: "run-once-on-start" });

    runAgent.mockResolvedValue(answer([fomc, { ...fomc, title: "Rumoured listing", url: "" }]));
    expect(await runJob("daily")).toBe("1 new, 0 updated, 1 rejected.");
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "a1", purpose: "market calendar collection, next 7 days", prompt: expect.stringMatching(/skip anything you cannot source/) }));
    expect(await runJob("daily")).toBe("0 new, 1 updated, 1 rejected.");
    const store = pluginStore("calendar", h.root);
    expect(await store.read<CalendarEvent[]>("events.json", [])).toHaveLength(1);
    expect(await store.read("collection.json", null)).toMatchObject({ days: 7, added: 0, updated: 1, rejected: ['no source URL: "Rumoured listing"'] });

    runAgent.mockResolvedValue({ ok: false, error: "No OpenRouter key: this agent cannot run." });
    await expect(runJob("weekly")).rejects.toThrow("No OpenRouter key");
    runAgent.mockResolvedValue({ ok: true, text: "I could not find anything." });
    await expect(runJob("weekly")).rejects.toThrow(/no JSON list/);
  });

  it("searches the table and the computed expiries, with their sources", async () => {
    h = await harness([scheduler, calendarPlugin]);
    runAgent.mockResolvedValue(answer([fomc]));
    await runJob("daily");
    const r = await h.tool("EventSearch").execute({ days: 14 }, h.ctx());
    expect(r.output).toMatch(/- .* — FOMC rate decision · Macro, importance 3 · source: Federal Reserve https:\/\/www\.federalreserve\.gov\/.*\(collected \d{4}-\d{2}-\d{2}\)/);
    expect(r.output).toMatch(/Deribit BTC & ETH .* options and futures expiry \[BTC, ETH\] · Options & futures expiry/);
    expect(r.output).toMatch(/Last collection: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\./);
    expect(r.card).toMatchObject({ kind: "table" });
    expect(await h.tool("EventSearch").execute({ watchlist: true }, h.ctx())).toMatchObject({ ok: false, output: "The watchlist plugin is off: give `assets` instead." });
    expect((await h.tool("EventSearch").execute({ days: 1, text: "nothing like this" }, h.ctx())).output).toMatch(/^No event .* for these filters\./);
  });

  it("refreshes on request, tells the agents what is coming, serves the alerts", async () => {
    let service: CalendarService | undefined;
    const alerts = definePlugin({
      manifest: manifest("alerts", [], ["calendar"]),
      setup(ctx) {
        service = ctx.optional<CalendarService>("calendar");
      },
    });
    h = await harness([scheduler, calendarPlugin, alerts]);
    expect((await h.tool("EventRefresh").execute({ days: 30 }, h.ctx())).output).toMatch(/^Collection of the next 30 days requested/);
    expect(triggered).toEqual(["calendar:weekly"]);

    runAgent.mockResolvedValue(answer([fomc, { ...fomc, title: "ARB unlock", category: "unlock", assets: ["ARB"], importance: 2, startsAt: soon(5), url: "https://token.unlocks.app/arbitrum" }]));
    await runJob("daily");
    const prompt = await h.runtime.prompts(["calendar"], { agentId: "a1", engine: "native", subagent: false }, {});
    /* A computed quarterly expiry may come first, depending on the day. */
    expect(prompt[0]).toMatch(/^## Market events in the next 48 hours\n/);
    expect(prompt[0]).toContain("FOMC rate decision");
    expect(prompt[0]).not.toContain("ARB unlock");
    expect((await service!.upcoming({ assets: ["ARB"], withinHours: 10 })).map((e) => e.title)).toEqual(["ARB unlock"]);
  });
});
