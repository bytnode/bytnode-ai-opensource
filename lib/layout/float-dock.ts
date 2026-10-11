/* ---------------------------------------------------------------------------
   Where the floating agent sits (`components/chat/floating-chat.tsx`): the
   avatar the user drags anywhere and that, let go, sticks to the nearest
   EDGE of the window — left, right, top or bottom — and the small
   conversation it opens, laid against it. Pure geometry, in CSS pixels, so
   it is tested without a DOM.

   THE AVATAR IS THE ANCHOR (user requests, 2026-10-06): it never moves
   when the conversation opens, and it never stands in the middle of the
   screen. The box is laid against it, on the side of the screen's middle:
   ABOVE it when the avatar is in the lower half, UNDER it in the upper
   half, its outer edge lined up with the avatar's — so the avatar is
   always at the box's outer corner (the box at the bottom on the left: the
   avatar at its bottom-left corner). Because the avatar is placed at an
   edge, the box can be placed anywhere along any edge.

   The avatar's place is kept as an EDGE and a FRACTION along it, not as
   pixels: a resized window keeps it on its edge, at the same relative
   place, and never off screen.
--------------------------------------------------------------------------- */

/** The avatar's box: what the hand grabs. Its glow and the points
    orbiting it are drawn past it (`.fc-canvas`). */
export const AVATAR = 80;
/** Its distance to the window's edges. */
export const MARGIN = 18;
/** Between the avatar and its conversation. */
export const GAP = 12;

export const PANEL_MIN_WIDTH = 300;
export const PANEL_MAX_WIDTH = 640;
export const PANEL_MIN_HEIGHT = 280;
export const PANEL_MAX_HEIGHT = 900;
export const PANEL_DEFAULT = { width: 380, height: 520 };

/** The half of the window it is in, across: the box reaches toward the
    other. */
export type Side = "left" | "right";
export type Edge = "left" | "right" | "top" | "bottom";
/** Where the avatar rests: an edge, and its place along it — from the top
    (0) to the bottom (1) of the usable room on a side edge, from the left
    (0) to the right (1) on the top and bottom edges. */
export type Dock = { edge: Edge; t: number };
/** The room it may use: the window, under `top` (the tab bar). */
export type Viewport = { width: number; height: number; top: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
/** The conversation's box. `above`: it stands over the avatar (the avatar
    in the lower half), otherwise under it. */
export type PanelBox = { left: number; top: number; width: number; height: number; side: Side; above: boolean };

/** Bottom right, a little raised: the window's very corner is where the
    framework's own dev badge sits. */
export const DEFAULT_DOCK: Dock = { edge: "right", t: 0.9 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The vertical room the avatar's top may move in. */
function rail(vp: Viewport): [number, number] {
  const lo = vp.top + MARGIN;
  return [lo, Math.max(lo, vp.height - MARGIN - AVATAR)];
}

/** The horizontal room its left may move in. */
function track(vp: Viewport): [number, number] {
  return [MARGIN, Math.max(MARGIN, vp.width - MARGIN - AVATAR)];
}

/** The avatar's top-left corner when it rests at `dock`. */
export function avatarAt(dock: Dock, vp: Viewport): Point {
  const [lo, hi] = rail(vp);
  const [l, r] = track(vp);
  const t = clamp(dock.t, 0, 1);
  if (dock.edge === "top" || dock.edge === "bottom") return { x: Math.round(l + t * (r - l)), y: dock.edge === "top" ? lo : hi };
  return { x: dock.edge === "left" ? l : r, y: Math.round(lo + t * (hi - lo)) };
}

/** A position while it is dragged: anywhere in the room, never out of it. */
export function clampAvatar(p: Point, vp: Viewport): Point {
  const [lo, hi] = rail(vp);
  const [l, r] = track(vp);
  return { x: clamp(p.x, l, r), y: clamp(p.y, lo, hi) };
}

/** The half its centre is in, across. */
export const sideOf = (p: Point, vp: Viewport): Side => (p.x + AVATAR / 2 < vp.width / 2 ? "left" : "right");

/** Let go at `p`: it sticks to the NEAREST edge of the four, where it is
    along it. */
export function dockFrom(p: Point, vp: Viewport): Dock {
  const [lo, hi] = rail(vp);
  const [l, r] = track(vp);
  const q = clampAvatar(p, vp);
  const near: Array<[Edge, number]> = [
    ["left", q.x - l],
    ["right", r - q.x],
    ["top", q.y - lo],
    ["bottom", hi - q.y],
  ];
  const edge = near.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  const along = edge === "top" || edge === "bottom" ? (r > l ? (q.x - l) / (r - l) : 0) : hi > lo ? (q.y - lo) / (hi - lo) : 1;
  /* Four decimals: a place within a pixel on any screen (three put it a
     pixel off on a wide one). */
  return { edge, t: Math.round(along * 10000) / 10000 };
}

export const clampPanelWidth = (w: number) => Math.round(clamp(w, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH));
export const clampPanelHeight = (h: number) => Math.round(clamp(h, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT));

/** The conversation's box for an avatar at `at` (top-left): against it,
    toward the screen's middle — above it from the lower half, under it
    from the upper half —, its outer edge lined up with the avatar's, so
    the avatar is at its outer corner. Shortened when the room is short;
    never past the window. The avatar does not move. */
export function panelBox(at: Point, size: Size, vp: Viewport): PanelBox {
  const side = sideOf(at, vp);
  const above = at.y + AVATAR / 2 > (vp.top + vp.height) / 2;
  const width = Math.max(0, Math.min(clampPanelWidth(size.width), vp.width - 2 * MARGIN));
  const room = above ? at.y - GAP - (vp.top + MARGIN) : vp.height - MARGIN - (at.y + AVATAR + GAP);
  const height = Math.max(0, Math.min(clampPanelHeight(size.height), room));
  const left = clamp(side === "right" ? at.x + AVATAR - width : at.x, MARGIN, Math.max(MARGIN, vp.width - MARGIN - width));
  const top = above ? at.y - GAP - height : at.y + AVATAR + GAP;
  return { left, top, width, height, side, above };
}

/** A corner of the conversation, to resize it by. */
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** The corner where the avatar stands: it holds the box, it is not a
    grip. */
export function anchorCorner(box: Pick<PanelBox, "side" | "above">): Corner {
  return `${box.above ? "bottom" : "top"}-${box.side}` as Corner;
}

/** The size after `corner` moved by `dx`, `dy` from where it was taken.
    The box stays held at the avatar's corner: a grip's move counts only
    along the edges that are free — a corner sharing the avatar's side or
    its row moves the box one way only. Bounded. */
export function resizeBy(corner: Corner, start: Size, box: Pick<PanelBox, "side" | "above">, dx: number, dy: number): Size {
  const [vertical, horizontal] = corner.split("-") as ["top" | "bottom", Side];
  const heldX = horizontal === box.side;
  const heldY = vertical === (box.above ? "bottom" : "top");
  return {
    width: clampPanelWidth(heldX ? start.width : start.width + (horizontal === "left" ? -dx : dx)),
    height: clampPanelHeight(heldY ? start.height : start.height + (vertical === "top" ? -dy : dy)),
  };
}
