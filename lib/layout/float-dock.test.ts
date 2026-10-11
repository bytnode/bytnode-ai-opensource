import { describe, expect, it } from "vitest";
import {
  AVATAR,
  GAP,
  MARGIN,
  PANEL_MAX_WIDTH,
  PANEL_MIN_HEIGHT,
  anchorCorner,
  avatarAt,
  clampAvatar,
  dockFrom,
  panelBox,
  resizeBy,
} from "./float-dock";

const vp = { width: 1600, height: 900, top: 50 };
const size = { width: 380, height: 520 };

describe("avatarAt / dockFrom", () => {
  it("rests at the bottom right", () => {
    expect(avatarAt({ edge: "right", t: 1 }, vp)).toEqual({ x: 1600 - MARGIN - AVATAR, y: 900 - MARGIN - AVATAR });
  });

  it("rests under the tab bar at the top", () => {
    expect(avatarAt({ edge: "left", t: 0 }, vp)).toEqual({ x: MARGIN, y: 50 + MARGIN });
  });

  it("sticks to the nearest of the four edges, where it was along it", () => {
    const d = dockFrom({ x: 60, y: 50 + MARGIN + (900 - MARGIN - AVATAR - 50 - MARGIN) / 2 }, vp);
    expect(d.edge).toBe("left");
    expect(d.t).toBeCloseTo(0.5, 2);
    expect(dockFrom({ x: 1450, y: 400 }, vp).edge).toBe("right");
    const top = dockFrom({ x: 800, y: 70 }, vp);
    expect(top.edge).toBe("top");
    expect(avatarAt(top, vp)).toEqual({ x: 800, y: 50 + MARGIN });
    const bottom = dockFrom({ x: 500, y: 880 }, vp);
    expect(bottom.edge).toBe("bottom");
    expect(avatarAt(bottom, vp)).toEqual({ x: 500, y: 900 - MARGIN - AVATAR });
  });

  it("round-trips through a resized window without leaving it", () => {
    const d = dockFrom({ x: 1500, y: 700 }, vp);
    const small = { width: 700, height: 500, top: 50 };
    const p = avatarAt(d, small);
    expect(p.x).toBeLessThanOrEqual(700 - MARGIN - AVATAR);
    expect(p.y).toBeGreaterThanOrEqual(50 + MARGIN);
    expect(p.y).toBeLessThanOrEqual(500 - MARGIN - AVATAR);
  });

  it("keeps a dragged avatar in the room", () => {
    expect(clampAvatar({ x: -40, y: 0 }, vp)).toEqual({ x: MARGIN, y: 50 + MARGIN });
    expect(clampAvatar({ x: 4000, y: 4000 }, vp)).toEqual({ x: 1600 - MARGIN - AVATAR, y: 900 - MARGIN - AVATAR });
  });
});

describe("panelBox: the avatar is the anchor", () => {
  it("at the bottom on the left, the box stands above it and the avatar is at its bottom-left corner", () => {
    const at = avatarAt({ edge: "bottom", t: 0 }, vp);
    const b = panelBox(at, size, vp);
    expect(b.above).toBe(true);
    expect(b.left).toBe(at.x);
    expect(b.top + b.height + GAP).toBe(at.y);
    expect(anchorCorner(b)).toBe("bottom-left");
  });

  it("at the bottom right, right edges lined up", () => {
    const at = avatarAt({ edge: "right", t: 1 }, vp);
    const b = panelBox(at, size, vp);
    expect(b.left + b.width).toBe(at.x + AVATAR);
    expect(b.top + b.height + GAP).toBe(at.y);
    expect(b.height).toBe(520);
  });

  it("at the top, the box hangs under it", () => {
    const at = avatarAt({ edge: "top", t: 0.8 }, vp);
    const b = panelBox(at, size, vp);
    expect(b.above).toBe(false);
    expect(b.top).toBe(at.y + AVATAR + GAP);
    expect(b.left + b.width).toBe(at.x + AVATAR);
    expect(anchorCorner(b)).toBe("top-right");
  });

  it("can stand anywhere along the bottom edge, the avatar at its corner", () => {
    const at = avatarAt({ edge: "bottom", t: 0.3 }, vp);
    const b = panelBox(at, size, vp);
    expect(b.left).toBe(at.x);
    expect(b.top + b.height + GAP).toBe(at.y);
  });

  it("shortens when the room is short, never past the window", () => {
    const at = { x: MARGIN, y: 400 };
    const b = panelBox(at, { width: 380, height: 900 }, vp);
    expect(b.top).toBeGreaterThanOrEqual(vp.top + MARGIN);
    expect(b.top + b.height).toBeLessThanOrEqual(vp.height - MARGIN);
  });

  it("never runs past a narrow window", () => {
    const narrow = { width: 360, height: 800, top: 40 };
    const b = panelBox(avatarAt({ edge: "right", t: 1 }, narrow), { width: PANEL_MAX_WIDTH, height: 520 }, narrow);
    expect(b.left).toBeGreaterThanOrEqual(MARGIN);
    expect(b.left + b.width).toBeLessThanOrEqual(360 - MARGIN);
  });
});

describe("resizeBy", () => {
  const box = { side: "left" as const, above: true };

  it("grows from the free corner both ways", () => {
    expect(resizeBy("top-right", size, box, 50, -40)).toEqual({ width: 430, height: 560 });
  });

  it("moves one way only from a corner sharing the avatar's side or row", () => {
    expect(resizeBy("top-left", size, box, -50, -40)).toEqual({ width: 380, height: 560 });
    expect(resizeBy("bottom-right", size, box, 50, 40)).toEqual({ width: 430, height: 520 });
  });

  it("is bounded", () => {
    expect(resizeBy("top-right", size, box, 5000, 5000)).toEqual({ width: PANEL_MAX_WIDTH, height: PANEL_MIN_HEIGHT });
  });
});
