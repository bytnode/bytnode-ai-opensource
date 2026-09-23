import { describe, expect, it } from "vitest";
import type { Quote } from "../shared/quote";
import { CORNER, changeOf, heatOf, outerCorners, sortByMove } from "./heat";

const quote = (c: Partial<Quote>): Quote => ({ symbol: "BTC/USDT", price: 1, source: "bytnode", at: "2026-09-23T00:00:00Z", ...c });

describe("changeOf", () => {
  it("reads the window's change", () => {
    const q = quote({ change1h: 0.5, change4h: -1, change24h: 2, change7d: 9 });
    expect(changeOf(q, "1h")).toBe(0.5);
    expect(changeOf(q, "4h")).toBe(-1);
    expect(changeOf(q, "24h")).toBe(2);
    expect(changeOf(q, "7d")).toBe(9);
  });

  it("is undefined without a quote or a figure", () => {
    expect(changeOf(null, "24h")).toBeUndefined();
    expect(changeOf(quote({}), "24h")).toBeUndefined();
    expect(changeOf(quote({ change24h: Number.NaN }), "24h")).toBeUndefined();
  });
});

describe("heatOf", () => {
  it("is signed and saturates at the window's scale", () => {
    expect(heatOf(8, "24h")).toBe(1);
    expect(heatOf(-30, "24h")).toBe(-1);
    expect(heatOf(20, "7d")).toBe(1);
    expect(heatOf(2, "1h")).toBe(1);
  });

  it("eases small moves up so they still show", () => {
    const h = heatOf(2, "24h");
    expect(h).toBeGreaterThan(0.25);
    expect(h).toBeLessThan(1);
    expect(heatOf(-2, "24h")).toBe(-h);
  });

  it("is 0 when unknown or flat", () => {
    expect(heatOf(undefined, "24h")).toBe(0);
    expect(heatOf(0, "24h")).toBe(0);
  });
});

describe("outerCorners", () => {
  it("rounds the four corners of a full grid only", () => {
    // 2 rows of 3
    expect(outerCorners(0, 6, 3)).toBe(CORNER.tl);
    expect(outerCorners(1, 6, 3)).toBe(0);
    expect(outerCorners(2, 6, 3)).toBe(CORNER.tr);
    expect(outerCorners(3, 6, 3)).toBe(CORNER.bl);
    expect(outerCorners(4, 6, 3)).toBe(0);
    expect(outerCorners(5, 6, 3)).toBe(CORNER.br);
  });

  it("gives the row above a short last row its bottom-right corner", () => {
    // 3 + 1: the last tile closes the grid, the first row's end too
    expect(outerCorners(2, 4, 3)).toBe(CORNER.tr | CORNER.br);
    expect(outerCorners(3, 4, 3)).toBe(CORNER.bl | CORNER.br);
  });

  it("rounds a single row at both ends, a single tile everywhere", () => {
    expect(outerCorners(0, 3, 5)).toBe(CORNER.tl | CORNER.bl);
    expect(outerCorners(2, 3, 5)).toBe(CORNER.tr | CORNER.br);
    expect(outerCorners(0, 1, 4)).toBe(CORNER.tl | CORNER.tr | CORNER.bl | CORNER.br);
  });

  it("is 0 out of range", () => {
    expect(outerCorners(4, 4, 3)).toBe(0);
    expect(outerCorners(0, 4, 0)).toBe(0);
  });
});

describe("sortByMove", () => {
  const rows = [
    { id: "a", quote: quote({ change24h: 1 }) },
    { id: "b", quote: null },
    { id: "c", quote: quote({ change24h: -5 }) },
    { id: "d", quote: quote({ change24h: 3 }) },
  ];

  it("keeps the user's order when asked", () => {
    expect(sortByMove(rows, "24h", false).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("orders by the size of the move, the unknown last", () => {
    expect(sortByMove(rows, "24h", true).map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
  });
});
