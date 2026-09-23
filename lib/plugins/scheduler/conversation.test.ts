import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { importBatch, runConversation } from "./conversation";
import type { RunRecord } from "./tasks";

const agent = { id: "a1", name: "Analyst", defaultModelId: "anthropic/claude-sonnet-5", defaultEffort: "low" } as AgentConfig;
const run = (id: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id,
  kind: "task",
  ref: "t1",
  title: "Morning brief",
  agentId: "a1",
  prompt: "Brief me on BTC.",
  startedAt: "2026-09-23T06:00:00.000Z",
  finishedAt: `2026-09-23T06:0${id}:00.000Z`,
  ok: true,
  text: "BTC is up 2 %.",
  ...over,
});

describe("scheduled runs as conversations", () => {
  it("the instruction as the question, the report as the answer", () => {
    expect(runConversation(run("1"), agent)).toEqual({
      id: "run-1",
      agentId: "a1",
      title: "Morning brief · 2026-09-23",
      modelId: "anthropic/claude-sonnet-5",
      effort: "low",
      scheduled: { taskId: "t1", runId: "1" },
      createdAt: Date.parse("2026-09-23T06:01:00.000Z"),
      updatedAt: Date.parse("2026-09-23T06:01:00.000Z"),
      messages: [
        { id: "1-q", role: "user", content: "Brief me on BTC.", createdAt: Date.parse("2026-09-23T06:00:00.000Z") },
        { id: "1-a", role: "assistant", content: "BTC is up 2 %.", createdAt: Date.parse("2026-09-23T06:01:00.000Z") },
      ],
    });
  });

  it("imports what is new, of an agent that still exists, and moves on", () => {
    const runs = [run("1"), run("2", { agentId: "gone" }), run("3", { ok: false }), run("4")];
    const r = importBatch(runs, [agent], new Set(["run-4"]), "");
    expect(r.conversations.map((c) => c.id)).toEqual(["run-1"]);
    expect(r.since).toBe("2026-09-23T06:04:00.000Z");
    expect(importBatch([], [agent], new Set(), r.since).since).toBe(r.since);
  });
});
