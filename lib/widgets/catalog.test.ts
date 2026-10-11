import { describe, expect, it } from "vitest";
import {
  CELL,
  CLEARANCE,
  GAP,
  LEAST,
  ORIGIN,
  REACH,
  SIZE_PX,
  WIDGETS,
  addWidget,
  clampPosition,
  edgeOf,
  fitWidgets,
  hideWidget,
  insidePage,
  logicalArea,
  moveWidgetTo,
  placeWidget,
  readWidgets,
  removeWidget,
  resizeWidget,
  roomFor,
  showHidden,
  widgetOn,
  widgetScale,
  type Page,
  type PlacedWidget,
  type Rect,
} from "./catalog";

const area = { width: 1400, height: 860 };
const button: Rect = { x: 1290, y: 12, w: 96, h: 50 };
const page: Page = { area, head: 90, blocked: [button] };
const w = (id: string, size: PlacedWidget["size"] = "small", x = area.width - ORIGIN.x - CELL, y = ORIGIN.y, kind: PlacedWidget["kind"] = "watchlist"): PlacedWidget => ({ id, kind, size, x, y });
const gap = (x: { x: number; y: number; size: PlacedWidget["size"] }, a = area) => Math.min(x.x, a.width - x.x - SIZE_PX[x.size].w, x.y, a.height - x.y - SIZE_PX[x.size].h);
const boxOf = (x: PlacedWidget): Rect => ({ x: x.x, y: x.y, ...SIZE_PX[x.size] });
const meet = (A: Rect, B: Rect) => A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
const overlap = (a: PlacedWidget, b: PlacedWidget) => meet(boxOf(a), boxOf(b));

describe("widgets catalog", () => {
  it("offers every widget in at least one size, its plugin named", () => {
    for (const info of WIDGETS) {
      expect(info.sizes.length).toBeGreaterThan(0);
      expect(info.plugin).toBeTruthy();
    }
  });

  it("reads a stored list, dropping what it does not know, placing what has no place", () => {
    const s = readWidgets({ open: true, items: [w("a"), { id: "b", kind: "nope", size: "small" }, { id: "c", kind: "calculator", size: "small" }, null], area: { width: 1200, height: 800 } });
    expect(s.open).toBe(true);
    expect(s.area).toEqual({ width: 1200, height: 800 });
    expect(s.items.map((x) => [x.id, x.size])).toEqual([["a", "small"], ["c", "medium"]]);
    expect(gap(s.items[1], { width: 1400, height: 900 })).toBeLessThanOrEqual(REACH);
    expect(readWidgets(null)).toEqual({ open: false, items: [] });
  });
});

describe("their scale follows the page", () => {
  it("smaller in a small window, larger in a large one, within bounds", () => {
    expect(widgetScale({ width: 1250, height: 860 })).toBe(1);
    expect(widgetScale({ width: 800, height: 860 })).toBe(0.64);
    expect(widgetScale({ width: 400, height: 300 })).toBe(0.6);
    expect(widgetScale({ width: 1500, height: 1000 })).toBe(1.16);
    expect(widgetScale({ width: 4000, height: 3000 })).toBe(1.25);
    expect(widgetScale({ width: 0, height: 0 })).toBe(1);
    expect(logicalArea({ width: 800, height: 860 })).toEqual({ width: 1250, height: 860 / 0.64 });
  });
});

describe("along the borders, never the middle", () => {
  it("each widget belongs to an edge: a side within reach of one, else the top or the bottom", () => {
    expect(edgeOf(w("a"), area)).toBe("right");
    expect(edgeOf(w("a", "small", 24, 24), area)).toBe("left");
    expect(edgeOf(w("a", "small", 600, 24), area)).toBe("top");
    expect(edgeOf(w("a", "small", 600, area.height - 24 - CELL), area)).toBe("bottom");
  });

  it("a position in the middle goes to the nearest border, two centimetres at most", () => {
    expect(clampPosition({ x: 300, y: 330 }, "small", area)).toEqual({ x: REACH, y: 330 });
    expect(clampPosition({ x: 1000, y: 330 }, "small", area)).toEqual({ x: area.width - REACH - CELL, y: 330 });
    expect(clampPosition({ x: 640, y: 560 }, "small", area)).toEqual({ x: 640, y: area.height - REACH - CELL });
    expect(clampPosition({ x: 50, y: 330 }, "small", area)).toEqual({ x: 50, y: 330 });
    expect(clampPosition({ x: -10, y: -10 }, "small", area)).toEqual({ x: 8, y: 8 });
  });

  it("places from the top right, down the right side, then the left side", () => {
    const right = area.width - ORIGIN.x - CELL;
    expect(placeWidget([], "small", page)).toEqual({ x: right, y: ORIGIN.y });
    expect(placeWidget([w("a")], "small", page)).toEqual({ x: right, y: ORIGIN.y + CELL + GAP });
    const short: Page = { area: { width: 1400, height: ORIGIN.y + CELL + 20 }, head: 0 };
    expect(placeWidget([w("a")], "small", short)).toEqual({ x: ORIGIN.x, y: ORIGIN.y });
  });

  it("every widget added stays along a border, on no other, off the button", () => {
    let items: PlacedWidget[] = [];
    for (let i = 0; i < 12; i++) items = addWidget(items, { id: `w${i}`, kind: "watchlist", size: i % 3 === 0 ? "medium" : "small" }, page);
    for (const it of items) {
      expect(gap(it)).toBeLessThanOrEqual(REACH);
      expect(meet(boxOf(it), button)).toBe(false);
      for (const other of items) if (other !== it) expect(overlap(it, other)).toBe(false);
    }
  });

  it("a drop on another widget or on the button goes to the nearest free place", () => {
    const items = moveWidgetTo([w("a"), w("b", "small", 24, 300)], "b", { x: area.width - 30 - CELL, y: ORIGIN.y + 10 }, page);
    expect(overlap(items[0], items[1])).toBe(false);
    expect(items.map((x) => x.id)).toEqual(["a", "b"]);
    const near = moveWidgetTo([w("a", "small", 24, 300)], "a", { x: 1280, y: 10 }, page)[0];
    expect(meet(boxOf(near), button)).toBe(false);
  });

  it("resizes within the widget's sizes, kept free", () => {
    const items = resizeWidget([w("a", "small", 24, 100), w("b", "small", 24, 100 + CELL + GAP)], "a", "large", page);
    expect(items[0].size).toBe("large");
    expect(overlap(items[0], items[1])).toBe(false);
    expect(resizeWidget([w("c", "medium", 24, 100, "calculator")], "c", "small", page)[0].size).toBe("medium");
    expect(removeWidget(items, "a").map((x) => x.id)).toEqual(["b"]);
  });
});

describe("the conversation's room", () => {
  it("nothing without widgets", () => {
    expect(roomFor([], page)).toEqual({ top: 0, thread: 0, bottom: 0, head: { left: 0, right: 0 }, body: { left: 0, right: 0 }, cramped: false });
  });

  it("a widget on a side narrows only the parts level with it", () => {
    const r = roomFor([w("a", "small", 24, 500)], page);
    expect(r.body.left).toBe(24 + CELL + CLEARANCE);
    expect(r.head.left).toBe(0);
    expect(r.top).toBe(0);
    const high = roomFor([w("b", "small", area.width - 24 - CELL, 100)], page);
    expect(high.head.right).toBe(24 + CELL + CLEARANCE);
    expect(high.body.right).toBe(24 + CELL + CLEARANCE);
  });

  it("a widget at the top over the thread lowers ONLY the thread, its text a centimetre under it", () => {
    const r = roomFor([w("t", "small", 600, 24)], page);
    expect(r.top).toBe(0);
    /* The thread's text: head (90) + its inner margin (12) + the room. */
    expect(90 + 12 + r.thread).toBe(24 + CELL + CLEARANCE);
    expect(r.head).toEqual({ left: 0, right: 0 });
    expect(r.body).toEqual({ left: 0, right: 0 });
  });

  it("a widget at the top over the title lowers the head, its text a centimetre under it", () => {
    const r = roomFor([w("t", "small", 100, 24)], { ...page, area: { width: 2400, height: 860 } });
    expect(r.top + 20).toBe(24 + CELL + CLEARANCE);
    expect(r.thread).toBe(0);
  });

  it("a widget at the top over neither moves nothing", () => {
    const wide: Page = { ...page, area: { width: 2400, height: 860 } };
    expect(roomFor([w("t", "small", 500, 24)], wide)).toMatchObject({ top: 0, thread: 0, bottom: 0 });
  });

  it("a widget at the bottom over the column raises the composer, its text a centimetre over it", () => {
    const r = roomFor([w("b", "small", 700, area.height - 24 - CELL)], page);
    expect(r.bottom).toBe(24 + CELL + CLEARANCE - 14);
    expect(roomFor([w("b", "small", 100, area.height - 24 - CELL)], page).bottom).toBe(0);
  });

  it("the same answer for the same places: nothing moves by itself", () => {
    const items = [w("a"), w("b", "medium", 24, 400), w("c", "small", 600, 24)];
    expect(roomFor(items, page)).toEqual(roomFor(items, page));
    expect(fitWidgets(items, area, page)).toEqual(fitWidgets(items, area, page));
    expect(fitWidgets(fitWidgets(items, area, page), area, page)).toEqual(fitWidgets(items, area, page));
  });

  it("never leaves the body less than its least width; such a place is refused", () => {
    const narrow: Page = { area: { width: 800, height: 860 }, head: 90 };
    const left = w("l", "large", 24, 300);
    const r = roomFor([left, w("r", "large", 800 - 24 - SIZE_PX.large.w, 300)], narrow);
    expect(r.cramped).toBe(true);
    expect(800 - r.body.left - r.body.right).toBeGreaterThanOrEqual(LEAST.body - 1);
    const placed = addWidget([left], { id: "r", kind: "watchlist", size: "large" }, narrow);
    expect(roomFor(placed, narrow).cramped).toBe(false);
  });
});

describe("a resized window", () => {
  it("carries each widget with its edge", () => {
    const from = { width: 1200, height: 800 };
    const to: Page = { area: { width: 1600, height: 900 }, head: 90 };
    const items = [w("r", "small", 1200 - 24 - CELL, 100), w("l", "small", 24, 100), w("b", "small", 24, 800 - 24 - CELL)];
    const fitted = fitWidgets(items, from, to);
    expect(fitted[0]).toMatchObject({ x: 1600 - 24 - CELL, y: 100 });
    expect(fitted[1]).toMatchObject({ x: 24, y: 100 });
    expect(fitted[2]).toMatchObject({ x: 24, y: 900 - 24 - CELL });
    const small: Page = { area: { width: 700, height: 500 }, head: 90 };
    for (const it of fitWidgets(items, from, small)) expect(gap(it, small.area)).toBeLessThanOrEqual(REACH);
    expect(fitWidgets(items, undefined, { area: from })).toEqual(items);
  });
});

describe("two small widgets side by side, never more", () => {
  const right = area.width - 24 - CELL;
  const slot = right - GAP - CELL;

  it("a small one dropped beside a small one on a side snaps level with it", () => {
    const items = moveWidgetTo([w("a", "small", right, 300), w("b", "small", 24, 600)], "b", { x: slot - 20, y: 320 }, page);
    expect(items.find((x) => x.id === "b")).toMatchObject({ x: slot, y: 300 });
    expect(edgeOf(items[1], area, [items[0]])).toBe("right");
    /* The conversation keeps its centimetre from the pair. */
    expect(roomFor(items, page).body.right).toBe(area.width - slot + CLEARANCE);
  });

  it("no third one beside the pair", () => {
    const pair = [w("a", "small", right, 300), w("b", "small", slot, 300)];
    const third = moveWidgetTo([...pair, w("c", "small", 24, 600)], "c", { x: slot - GAP - CELL, y: 300 }, page).find((x) => x.id === "c")!;
    expect(gap(third)).toBeLessThanOrEqual(REACH);
  });

  it("no third one in a row by the top border either", () => {
    const pair = [w("a", "small", right, 100), w("b", "small", slot, 100)];
    const c = moveWidgetTo([...pair, w("c", "small", 24, 600)], "c", { x: slot - GAP - CELL, y: 70 }, page).find((x) => x.id === "c")!;
    const level = c.y < 100 + CELL && 100 < c.y + CELL;
    expect(level && slot - (c.x + CELL) < CELL).toBe(false);
  });

  it("only small ones pair", () => {
    const medium = moveWidgetTo([w("a", "small", right, 300), w("m", "medium", 24, 600)], "m", { x: slot - SIZE_PX.medium.w + CELL, y: 300 }, page).find((x) => x.id === "m")!;
    expect(gap(medium)).toBeLessThanOrEqual(REACH);
  });

  it("a pair keeps together when the window is resized", () => {
    const from = { width: 1400, height: 860 };
    const pair = [w("b", "small", slot, 300), w("a", "small", right, 300)];
    const fitted = fitWidgets(pair, from, { area: { width: 1700, height: 860 } });
    expect(fitted.map((x) => x.id)).toEqual(["b", "a"]);
    expect(fitted[1].x - fitted[0].x).toBe(CELL + GAP);
    expect(fitted[1].x).toBe(1700 - 24 - CELL);
  });

  it("left alone when its partner goes, it goes back to a border", () => {
    const items = moveWidgetTo([w("a", "small", right, 300), w("b", "small", slot, 300)], "a", { x: 24, y: 600 }, page);
    const b = fitWidgets(items, area, page).find((x) => x.id === "b")!;
    expect(gap(b)).toBeLessThanOrEqual(REACH);
  });
});

describe("hidden from the right-click menu", () => {
  it("is kept but takes no room, and comes back at a free place", () => {
    const items = hideWidget([w("a"), w("b", "small", 24, 300)], "a");
    expect(items[0].hidden).toBe(true);
    const taken = addWidget(items, { id: "c", kind: "watchlist", size: "small" }, page);
    expect(taken[2]).toMatchObject({ x: area.width - ORIGIN.x - CELL, y: ORIGIN.y });
    const back = showHidden(taken, page);
    expect(back[0].hidden).toBeUndefined();
    expect(overlap(back[0], back[2])).toBe(false);
    expect(readWidgets({ items: [{ ...w("h"), hidden: true }] }).items[0].hidden).toBe(true);
  });
});

describe("carried anywhere, put right when let go", () => {
  const right = area.width - 24 - CELL;

  it("the hand carries it anywhere in the page", () => {
    expect(insidePage({ x: 600, y: 400 }, "small", area)).toEqual({ x: 600, y: 400 });
    expect(insidePage({ x: -50, y: 9000 }, "small", area)).toEqual({ x: 8, y: area.height - 8 - CELL });
  });

  it("let go farther than two centimetres from a border, it goes back by itself", () => {
    const a = moveWidgetTo([w("a")], "a", { x: 600, y: 400 }, page)[0];
    expect(gap(a)).toBeLessThanOrEqual(REACH);
  });

  it("a small one let go on a small one goes right beside it, level with it", () => {
    const onSide = moveWidgetTo([w("a", "small", right, 300), w("b", "small", 24, 600)], "b", { x: right + 20, y: 330 }, page);
    expect(onSide.find((x) => x.id === "b")).toMatchObject({ x: right - GAP - CELL, y: 300 });
    const onTop = moveWidgetTo([w("a", "small", 600, 24), w("b", "small", 24, 600)], "b", { x: 640, y: 40 }, page);
    expect(onTop.find((x) => x.id === "b")).toMatchObject({ x: 600 + CELL + GAP, y: 24 });
    const fromLeft = moveWidgetTo([w("a", "small", 600, 24), w("b", "small", 24, 600)], "b", { x: 560, y: 40 }, page);
    expect(fromLeft.find((x) => x.id === "b")).toMatchObject({ x: 600 - GAP - CELL, y: 24 });
  });

  it("never a third: let go on a pair, it goes to the nearest free place", () => {
    const pair = [w("a", "small", right, 300), w("b", "small", right - GAP - CELL, 300)];
    const c = moveWidgetTo([...pair, w("c", "small", 24, 600)], "c", { x: right - GAP - CELL - 20, y: 310 }, page).find((x) => x.id === "c")!;
    for (const o of pair) expect(overlap(c, o)).toBe(false);
    expect(c.y < 300 + CELL && 300 < c.y + CELL && right - GAP - CELL - (c.x + CELL) < CELL).toBe(false);
  });
});

describe("switched off in the settings", () => {
  it("reads and keeps the widgets switched off, dropping unknown kinds", () => {
    const s = readWidgets({ open: true, items: [w("a")], off: ["calendar", "nope", "alerts"] });
    expect(s.off).toEqual(["calendar", "alerts"]);
    expect(widgetOn(s, "calendar")).toBe(false);
    expect(widgetOn(s, "watchlist")).toBe(true);
    expect(readWidgets({ items: [] }).off).toBeUndefined();
  });
});
