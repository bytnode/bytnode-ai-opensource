import { describe, expect, it, vi } from "vitest";
import { Scope } from "./scope";
import { EventBus } from "./events";

describe("Scope", () => {
  it("undoes everything in reverse order, even past a failure", async () => {
    const order: string[] = [];
    const scope = new Scope();
    scope.add(() => void order.push("tool"));
    scope.add(() => {
      throw new Error("timer refused");
    });
    scope.add(async () => void order.push("job"));
    expect(await scope.dispose()).toEqual(["timer refused"]);
    expect(order).toEqual(["job", "tool"]);
    expect(scope.isClosed).toBe(true);
  });

  it("undoes at once what arrives after closing", async () => {
    const scope = new Scope();
    await scope.dispose();
    const late = vi.fn();
    scope.add(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late).toHaveBeenCalledOnce();
  });
});

describe("EventBus", () => {
  it("delivers to every listener; unsubscribing stops it", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    const off = bus.on("watchlist:changed", a);
    bus.on("watchlist:changed", b);
    bus.emit("watchlist:changed", { symbols: ["BTC/USDT"] });
    off();
    bus.emit("watchlist:changed", {});
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalledWith({ symbols: ["BTC/USDT"] });
  });

  it("a listener that throws is reported, the others still run", async () => {
    const report = vi.fn();
    const bus = new EventBus(report);
    const after = vi.fn();
    bus.on("x", () => {
      throw new Error("boom");
    });
    bus.on("x", async () => {
      throw new Error("async boom");
    });
    bus.on("x", after);
    bus.emit("x");
    await Promise.resolve();
    expect(after).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledTimes(2);
    expect(bus.count("x")).toBe(3);
  });
});
