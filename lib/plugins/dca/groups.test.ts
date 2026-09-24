import { describe, expect, it } from "vitest";
import { addGroup, curveDays, groupNamed, movePlan, planCurve, removeGroup, renameGroup } from "./groups";
import type { DcaPlan, Purchase } from "./plans";

const now = new Date("2026-09-24T10:00:00Z");
const plan = (id: string, symbol: string, groupId?: string): DcaPlan => ({ id, symbol, quoteAmount: 100, frequency: "daily at 09:00", destination: "paper", startAt: "", status: "active", createdAt: "", ...(groupId ? { groupId } : {}) });

describe("groups", () => {
  it("makes a group, refusing an empty or taken name", () => {
    const made = addGroup([], "  Long   term ", "g1", now);
    expect("error" in made ? made.error : made.group).toEqual({ id: "g1", name: "Long term", createdAt: now.toISOString() });
    const groups = "error" in made ? [] : made.groups;
    expect(addGroup(groups, "long TERM", "g2", now)).toEqual({ error: 'A group is already named "long TERM".' });
    expect(addGroup(groups, " ", "g2", now)).toEqual({ error: "Give the group a name." });
    expect(groupNamed(groups, "LONG term")?.id).toBe("g1");
  });

  it("renames a group, its own name allowed again", () => {
    const groups = [{ id: "g1", name: "Alts", createdAt: "" }, { id: "g2", name: "Core", createdAt: "" }];
    expect(renameGroup(groups, "g1", "alts")).toMatchObject({ group: { id: "g1", name: "alts" } });
    expect(renameGroup(groups, "g1", "Core")).toEqual({ error: 'A group is already named "Core".' });
  });

  it("deletes a group and keeps its plans, ungrouped", () => {
    const r = removeGroup([{ id: "g1", name: "Alts", createdAt: "" }], [plan("a", "SOL/USDT", "g1"), plan("b", "BTC/USDT")], "g1");
    expect("error" in r ? r.error : r.plans.map((p) => [p.id, p.groupId])).toEqual([
      ["a", undefined],
      ["b", undefined],
    ]);
    expect("error" in r ? r.error : r.groups).toEqual([]);
  });

  it("moves a plan into a group, and out", () => {
    const groups = [{ id: "g1", name: "Alts", createdAt: "" }];
    const into = movePlan([plan("a", "SOL/USDT")], groups, "a", "g1");
    expect("error" in into ? into.error : into.plan.groupId).toBe("g1");
    const out = movePlan([plan("a", "SOL/USDT", "g1")], groups, "a", null);
    expect("error" in out ? out.error : "groupId" in out.plan).toBe(false);
    expect(movePlan([plan("a", "SOL/USDT")], groups, "a", "nope")).toEqual({ error: "No such group." });
  });
});

describe("the plans' curve", () => {
  const fill = (planId: string, at: string, amount: number, price: number): Purchase => ({ id: at, planId, due: at, at, mode: "paper", status: "filled", amount, price });
  const bars = (closes: number[], from: string) => closes.map((c, i) => ({ t: Date.parse(`${from}T00:00:00Z`) + i * 86_400_000, o: c, h: c, l: c, c, v: 0 }));

  it("runs from the first purchase to today", () => {
    expect(curveDays([fill("a", "2026-09-22T09:00:00Z", 1, 100)], now)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(curveDays([], now)).toEqual([]);
  });

  it("values what was bought at each day's close, the day's purchases as its flow", () => {
    const days = ["2026-09-22", "2026-09-23", "2026-09-24"];
    const purchases = [fill("a", "2026-09-22T09:00:00Z", 1, 100), fill("a", "2026-09-24T09:00:00Z", 1, 120), fill("b", "2026-09-23T09:00:00Z", 10, 5)];
    const curve = planCurve([plan("a", "BTC/USDT"), plan("b", "SOL/USDT")], purchases, { "BTC/USDT": bars([110, 90, 130], "2026-09-22") }, days);
    /* SOL has no close: its purchase price. */
    expect(curve.map((b) => [b.c, b.v])).toEqual([
      [110, 100],
      [140, 50],
      [310, 120],
    ]);
  });
});
