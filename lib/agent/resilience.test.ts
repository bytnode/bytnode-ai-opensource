import { describe, expect, it } from "vitest";
import { RepetitionGuard, backoffDelay, isTransient } from "./resilience";
import { LlmError } from "@/lib/llm/client";

describe("isTransient", () => {
  it("retries on overload, server error and timeout", () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 504, 522, 529]) {
      expect(isTransient(new LlmError("x", s)), String(s)).toBe(true);
    }
  });

  it("does not retry on a request error", () => {
    for (const s of [400, 401, 402, 403, 404, 422]) {
      expect(isTransient(new LlmError("x", s)), String(s)).toBe(false);
    }
  });

  it("retries on a network drop", () => {
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient(new Error("socket hang up"))).toBe(true);
    expect(isTransient(new Error("ECONNRESET"))).toBe(true);
    expect(isTransient(new Error("terminated"))).toBe(true);
  });

  it("never retries a deliberate interruption", () => {
    const abort = new DOMException("Interrupted", "AbortError");
    expect(isTransient(abort)).toBe(false);
  });

  it("does not retry an error it does not recognise", () => {
    expect(isTransient(new Error("the model refused"))).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("grows and stays bounded", () => {
    expect(backoffDelay(0)).toBeLessThanOrEqual(1200);
    expect(backoffDelay(1)).toBeGreaterThan(backoffDelay(0) / 2);
    expect(backoffDelay(9)).toBeLessThanOrEqual(8000);
  });
});

describe("RepetitionGuard", () => {
  const call = (name: string, args: Record<string, unknown>) => ({ name, args });

  it("lets different calls through", () => {
    const g = new RepetitionGuard();
    expect(g.check(call("Read", { file_path: "a" }))).toBeNull();
    expect(g.check(call("Read", { file_path: "b" }))).toBeNull();
    expect(g.check(call("Bash", { command: "ls" }))).toBeNull();
  });

  it("cuts off at the third identical call", () => {
    const g = new RepetitionGuard();
    const a = call("Bash", { command: "python x.py" });
    expect(g.check(a)).toBeNull();
    expect(g.check(a)).toBeNull();
    const stop = g.check(a);
    expect(stop).toContain("3 times");
    expect(stop).toContain("python x.py");
  });

  it("ignores argument order", () => {
    const g = new RepetitionGuard();
    g.check(call("Edit", { file_path: "a", old: "x" }));
    g.check(call("Edit", { old: "x", file_path: "a" }));
    expect(g.check(call("Edit", { file_path: "a", old: "x" }))).not.toBeNull();
  });

  it("a call that succeeds resets its counter to zero", () => {
    const g = new RepetitionGuard();
    const a = call("Bash", { command: "ls" });
    g.check(a);
    g.check(a);
    g.succeeded(a);
    expect(g.check(a)).toBeNull();
    expect(g.check(a)).toBeNull();
    expect(g.check(a)).not.toBeNull();
  });

  it("counts two distinct calls separately", () => {
    const g = new RepetitionGuard();
    const a = call("Bash", { command: "a" });
    const b = call("Bash", { command: "b" });
    g.check(a);
    g.check(b);
    g.check(a);
    g.check(b);
    expect(g.check(a)).not.toBeNull();
    expect(g.check(b)).not.toBeNull();
  });
});
