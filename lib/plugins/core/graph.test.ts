import { describe, expect, it } from "vitest";
import { affectedBy, effectivelyEnabled, requiredBy, requirementsOf, startOrder } from "./graph";
import { manifest } from "./test-fixture";

/* scheduler ← alerts (requires scheduler, watchlist)
   paper ← dca (requires scheduler, paper)
   portfolio uses scheduler optionally */
const catalog = [
  manifest("dca", ["scheduler", "paper"]),
  manifest("alerts", ["scheduler", "watchlist"]),
  manifest("portfolio", [], ["scheduler", "report"]),
  manifest("watchlist"),
  manifest("paper"),
  manifest("scheduler"),
];

describe("startOrder", () => {
  it("starts every plugin after what it requires or uses", () => {
    const order = startOrder(catalog);
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before("scheduler", "dca");
    before("paper", "dca");
    before("watchlist", "alerts");
    before("scheduler", "portfolio");
    expect(order).toHaveLength(6);
  });

  it("refuses a cycle and an unknown requirement, ignores an unknown optional", () => {
    expect(() => startOrder([manifest("a", ["b"]), manifest("b", ["a"])])).toThrow(/cycle: a → b → a/);
    expect(() => startOrder([manifest("a", ["ghost"])])).toThrow(/Unknown plugin required by a: ghost/);
    expect(startOrder([manifest("a", [], ["ghost"])])).toEqual(["a"]);
  });
});

describe("dependencies both ways", () => {
  it("what a plugin requires, transitively", () => {
    expect(requirementsOf([manifest("a", ["b"]), manifest("b", ["c"]), manifest("c")], "a").sort()).toEqual(["b", "c"]);
  });

  it("what goes down with a plugin: hard dependents only", () => {
    expect(requiredBy(catalog, "scheduler").sort()).toEqual(["alerts", "dca"]);
    expect(requiredBy(catalog, "watchlist")).toEqual(["alerts"]);
    expect(requiredBy(catalog, "dca")).toEqual([]);
  });

  it("what restarts with a plugin: hard and optional users", () => {
    expect(affectedBy(catalog, "scheduler").sort()).toEqual(["alerts", "dca", "portfolio"]);
  });

  it("a plugin whose requirement is off does not run", () => {
    const on = effectivelyEnabled(catalog, (id) => id !== "scheduler");
    expect([...on].sort()).toEqual(["paper", "portfolio", "watchlist"]);
  });
});
