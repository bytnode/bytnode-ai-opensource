/* ---------------------------------------------------------------------------
   The widgets of the conversation page (user request, 2026-10-06): an
   excerpt of a plugin — its most important elements — floating along the
   page's borders, as on a Mac's desktop. Pure: what exists, in which
   sizes, where they stand, the room they leave the conversation, and the
   edits of the user's list. The drawing is in `components/chat/widgets/`.

   Sizes are Apple's: SMALL a square, MEDIUM two squares wide and one
   high, LARGE two squares wide and two high. Each widget says which sizes
   it has.
--------------------------------------------------------------------------- */

export type WidgetSize = "small" | "medium" | "large";
export const SIZES: WidgetSize[] = ["small", "medium", "large"];

export type WidgetKind = "watchlist" | "portfolio" | "paper" | "dca" | "calendar" | "scheduler" | "alerts" | "calculator";

export type WidgetInfo = {
  kind: WidgetKind;
  /** The plugin it reads; the widget is offered only while it runs. */
  plugin: string;
  /** The plugin's tab it opens. */
  view: string | null;
  name: string;
  description: string;
  sizes: WidgetSize[];
};

export const WIDGETS: WidgetInfo[] = [
  { kind: "watchlist", plugin: "watchlist", view: "watchlist", name: "Watchlist", description: "Your assets, their price and their 24 h move.", sizes: ["small", "medium", "large"] },
  { kind: "portfolio", plugin: "portfolio", view: "portfolio", name: "Portfolio", description: "Your total, its move and how it is split.", sizes: ["small", "medium", "large"] },
  { kind: "paper", plugin: "paper-trading", view: "paper-trading", name: "Paper trading", description: "Your paper portfolio's value, return and open positions.", sizes: ["small", "medium", "large"] },
  { kind: "dca", plugin: "dca", view: "dca", name: "DCA", description: "Your next purchases and what the plans have put in.", sizes: ["small", "medium", "large"] },
  { kind: "calendar", plugin: "calendar", view: "calendar", name: "Calendar", description: "What comes next this week.", sizes: ["small", "medium", "large"] },
  { kind: "scheduler", plugin: "scheduler", view: "scheduler", name: "Scheduled tasks", description: "Your agents' next runs and their last reports.", sizes: ["small", "medium", "large"] },
  { kind: "alerts", plugin: "alerts", view: "alerts", name: "Alerts", description: "Your alerts, what they read now, the last that fired.", sizes: ["small", "medium", "large"] },
  { kind: "calculator", plugin: "position-calc", view: null, name: "Position size", description: "Size a trade from your risk, entry and stop.", sizes: ["medium", "large"] },
];

export const widgetInfo = (kind: WidgetKind): WidgetInfo | undefined => WIDGETS.find((w) => w.kind === kind);

/* --- The model ------------------------------------------------------------------

   Rebuilt on 2026-10-07 (user report: elements moving for nothing, others
   not moving, widgets re-placing themselves). The whole layout is ONE pure
   function of the widgets' places and of the page — its size, and its
   parts' NATURAL measures (`Page`: the head's height, where the title and
   the conversation's column stand, their inner margins) —, with no measure
   of anything the layout itself moves:

   1. Every widget lines a BORDER of the page, never its middle (`REACH`,
      two centimetres, user request), and so BELONGS to one edge
      (`edgeOf`): a side when it is within reach of one, else the top or
      the bottom. One exception (user request): a SMALL widget may stand
      right beside a small one that lines a side, toward the middle, level
      with it — two small ones side by side, never more (`pairSlots`: the
      one beside is not within reach of the side, so nothing can pair with
      it); it belongs to its partner's side. And never three in a row, on
      any border (`rowOf`).
   2. The conversation lives in what they leave (`roomFor`), its TEXT a
      two centimetres away (`CLEARANCE`) on every side alike (user request):
      a widget at the TOP lowers what stands under it — the head when it
      is over the title, the thread when it is over the conversation's
      column —, just enough; a widget at the BOTTOM over the column raises
      the composer; one over neither moves nothing. A widget on a SIDE
      narrows the head where it stands level with it, and the body (the
      thread and the composer, one column) where it stands level with it.
      The thread and the composer stay centred while the room allows it.
   3. A place that would leave the conversation too little room is refused
      like a place on another widget (`nearestFree`): the next one that
      fits is taken.

   Positions are in the widgets' OWN pixels (`logicalArea`: the page at
   their scale), from the page's top-left corner. */

/* A little smaller than Apple's (user request). */
export const CELL = 132;
export const GAP = 10;
export const SIZE_PX: Record<WidgetSize, { w: number; h: number }> = {
  small: { w: CELL, h: CELL },
  medium: { w: CELL * 2 + GAP, h: CELL },
  large: { w: CELL * 2 + GAP, h: CELL * 2 + GAP },
};
/** Where the first one goes: the top RIGHT, under the page's head (user
    request) — `x` is the distance from the page's RIGHT edge. */
export const ORIGIN = { x: 24, y: 100 };
/** Kept from the page's edges. */
const EDGE = 8;
/** About two centimetres: no widget stands farther than this from the
    page's NEAREST edge (user request). */
export const REACH = 76;
/** About two centimetres: no part of the conversation comes nearer a
    widget (user request — one centimetre first, then doubled: the
    conversation now makes way sooner). */
export const CLEARANCE = 76;
/** The least the conversation keeps: the body's width, the head's width,
    the height under the head. */
export const LEAST = { body: 400, head: 220, height: 260 };

export type Area = { width: number; height: number };
export type Position = { x: number; y: number };
/** A box on the page: a widget's, or what no widget may cover. */
export type Rect = { x: number; y: number; w: number; h: number };

/** A span across the page, from its left edge. */
export type Span = { left: number; right: number };

/** The page as the widgets see it: its size, the boxes no widget may
    cover (the widgets' button), and its parts' NATURAL measures — never
    changed by the room the widgets take: the head's height, the title's
    span (its ink, from the head's left padding), the conversation's column
    (the thread's width, centred) and the inner margins between each box
    and its text (`pad`: above the title, above the thread's text, under
    the composer). Defaults: the app's at scale 1. */
export type Page = {
  area: Area;
  blocked?: Rect[];
  head?: number;
  title?: Span;
  column?: Span;
  pad?: { head: number; thread: number; composer: number };
};

/** A widget on the page. The last in the list is drawn on top. */
export type PlacedWidget = { id: string; kind: WidgetKind; size: WidgetSize; x: number; y: number; hidden?: boolean };

/** What the places' rules read of a widget. A `hidden` one (hidden from
    its right-click menu) takes no room and blocks nothing. */
type Placed = Pick<PlacedWidget, "x" | "y" | "size"> & { hidden?: boolean };

/** `area`: the page's size when the places were last written — a window
    resized since carries them to the new size (`fitWidgets`). `off`: the
    widgets switched off in Settings → Widgets (user request) — neither
    drawn nor offered; the ones placed keep their place. */
export type WidgetsState = { open: boolean; items: PlacedWidget[]; area?: Area; off?: WidgetKind[] };

/** Whether a widget is switched on in the settings. */
export const widgetOn = (state: Pick<WidgetsState, "off">, kind: WidgetKind): boolean => !state.off?.includes(kind);

export const EMPTY_WIDGETS: WidgetsState = { open: false, items: [] };

const HEAD = 90;
const PAD = { head: 20, thread: 12, composer: 14 };
const THREAD = 736;
const rectOf = (w: Pick<PlacedWidget, "x" | "y" | "size">): Rect => ({ x: w.x, y: w.y, ...SIZE_PX[w.size] });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/* --- Their scale follows the page --------------------------------------------- */

/** The page size at which the widgets are drawn at their own size. */
const REF: Area = { width: 1250, height: 860 };

/** How big the widgets are drawn on a page of `screen` CSS pixels: they
    shrink with a small window and grow with a large one (user request) —
    1 at `REF`, between 0.6 and 1.25, in steps of 0.01 so a resize does not
    shake them. */
export function widgetScale(screen: Area): number {
  if (screen.width <= 0 || screen.height <= 0) return 1;
  const k = Math.min(screen.width / REF.width, screen.height / REF.height);
  return Math.round(Math.min(1.25, Math.max(0.6, k)) * 100) / 100;
}

/** The page in the widgets' own pixels. */
export const logicalArea = (screen: Area, k = widgetScale(screen)): Area => ({ width: screen.width / k, height: screen.height / k });

/* --- 1. Along the borders ------------------------------------------------------- */

export type Edge = "left" | "right" | "top" | "bottom";

/** Where a second small widget may stand: right beside each small one
    that lines a side, toward the middle, level with it (user request: two
    small widgets side by side, never more — the one beside is not within
    reach of the side, so nothing pairs with it). */
export function pairSlots(others: Placed[], area: Area): Array<Position & { side: "left" | "right" }> {
  const out: Array<Position & { side: "left" | "right" }> = [];
  for (const o of others) {
    if (o.size !== "small" || o.hidden) continue;
    if (o.x <= REACH) out.push({ x: o.x + CELL + GAP, y: o.y, side: "left" });
    else if (area.width - o.x - CELL <= REACH) out.push({ x: o.x - GAP - CELL, y: o.y, side: "right" });
  }
  return out;
}

/** The side whose partner a small widget stands beside, if it does. */
function pairedSide(w: Placed, others: Placed[], area: Area): "left" | "right" | null {
  if (w.size !== "small") return null;
  const slot = pairSlots(others, area).find((s) => Math.abs(s.x - w.x) < 1 && Math.abs(s.y - w.y) < 1);
  return slot?.side ?? null;
}

/** The edge a widget belongs to: a SIDE when it is within reach of one
    (beside the conversation) or stands beside a small partner there, else
    the top or the bottom, the nearer. */
export function edgeOf(w: Placed, area: Area, others: Placed[] = []): Edge {
  const { w: ww, h } = SIZE_PX[w.size];
  const left = w.x;
  const right = area.width - w.x - ww;
  if (Math.min(left, right) <= REACH) return left <= right ? "left" : "right";
  const paired = pairedSide(w, others, area);
  if (paired) return paired;
  return w.y <= area.height - w.y - h ? "top" : "bottom";
}

/** A position kept inside the page — and nothing more: where the hand
    carries a widget, anywhere (user request: no invisible wall while it
    moves; the rules apply when it is let go, `moveWidgetTo`). */
export function insidePage(p: Position, size: WidgetSize, area: Area): Position {
  const { w, h } = SIZE_PX[size];
  return {
    x: Math.round(Math.min(Math.max(EDGE, p.x), Math.max(EDGE, area.width - EDGE - w))),
    y: Math.round(Math.min(Math.max(EDGE, p.y), Math.max(EDGE, area.height - EDGE - h))),
  };
}

/** A position kept inside the page AND within `REACH` of its nearest edge
    — or, for a small widget, in a pair's slot beside one of `others` —,
    brought to the nearer of the two by the shortest move. */
export function clampPosition(p: Position, size: WidgetSize, area: Area, others: Placed[] = []): Position {
  const { w, h } = SIZE_PX[size];
  const x = Math.min(Math.max(EDGE, p.x), Math.max(EDGE, area.width - EDGE - w));
  const y = Math.min(Math.max(EDGE, p.y), Math.max(EDGE, area.height - EDGE - h));
  const gaps = [x, area.width - x - w, y, area.height - y - h];
  const nearest = Math.min(...gaps);
  if (nearest <= REACH) return { x: Math.round(x), y: Math.round(y) };
  const side = gaps.indexOf(nearest);
  const candidates: Position[] = [
    side === 0 ? { x: REACH, y } : side === 1 ? { x: area.width - REACH - w, y } : side === 2 ? { x, y: REACH } : { x, y: area.height - REACH - h },
  ];
  if (size === "small") candidates.push(...pairSlots(others, area));
  let best = candidates[0];
  for (const c of candidates) if (Math.hypot(c.x - x, c.y - y) < Math.hypot(best.x - x, best.y - y)) best = c;
  return { x: Math.round(best.x), y: Math.round(best.y) };
}

/* --- 2. The conversation's room --------------------------------------------------- */

/** Where the conversation stands: `top` lowers the head (and all under
    it), `thread` lowers the thread under the head, `bottom` raises the
    composer; `head` and `body` are each part's left and right distance
    from the page's sides. `cramped`: the widgets leave less than `LEAST` —
    the distances are then cut down to it, and a new place is refused. */
export type Room = {
  top: number;
  thread: number;
  bottom: number;
  head: { left: number; right: number };
  body: { left: number; right: number };
  cramped: boolean;
};

export function roomFor(items: Placed[], page: Page): Room {
  const { area } = page;
  const headH = page.head ?? HEAD;
  const pad = page.pad ?? PAD;
  const title = page.title ?? { left: 30, right: 300 };
  const width = Math.min(THREAD, area.width - 56);
  const column = page.column ?? { left: (area.width - width) / 2, right: (area.width + width) / 2 };
  /* Over a span: across it, or within `CLEARANCE` of it. */
  const over = (r: Rect, s: Span) => r.x < s.right + CLEARANCE && r.x + r.w > s.left - CLEARANCE;
  const tops: Rect[] = [];
  let bottom = 0;
  const sides: Array<{ edge: "left" | "right"; r: Rect }> = [];
  for (const it of items) {
    const r = rectOf(it);
    const edge = edgeOf(it, area, items);
    if (edge === "top") tops.push(r);
    /* Under the composer's text: its box's bottom margin is part of it. */
    else if (edge === "bottom") {
      if (over(r, column)) bottom = Math.max(bottom, area.height - r.y + CLEARANCE - pad.composer);
    } else sides.push({ edge, r });
  }
  /* The title's text starts `pad.head` under the head's top; the thread's
     text `pad.thread` under the head's bottom. Each goes down just enough
     to keep `CLEARANCE` under the widgets over it. */
  let top = 0;
  for (const r of tops) if (over(r, title)) top = Math.max(top, r.y + r.h + CLEARANCE - pad.head);
  let thread = 0;
  for (const r of tops) if (over(r, column)) thread = Math.max(thread, r.y + r.h + CLEARANCE - (top + headH + pad.thread));
  let cramped = false;
  const tall = area.height - headH - LEAST.height;
  const down = top + thread + bottom;
  if (down > 0 && down > tall) {
    cramped = true;
    const k = Math.max(0, tall) / down;
    top *= k;
    thread *= k;
    bottom *= k;
  }
  /* Who stands level with a band [from, to], `CLEARANCE` around it. */
  const beside = (from: number, to: number, least: number) => {
    let left = 0;
    let right = 0;
    for (const { edge, r } of sides) {
      if (r.y >= to + CLEARANCE || r.y + r.h <= from - CLEARANCE) continue;
      if (edge === "left") left = Math.max(left, r.x + r.w + CLEARANCE);
      else right = Math.max(right, area.width - r.x + CLEARANCE);
    }
    const room = area.width - least;
    if (left + right > 0 && left + right > room) {
      cramped = true;
      const k = Math.max(0, room) / (left + right);
      left *= k;
      right *= k;
    }
    return { left: Math.round(left), right: Math.round(right) };
  };
  const head = beside(top, top + headH, LEAST.head);
  const body = beside(top + headH + thread, area.height - bottom, LEAST.body);
  return { top: Math.round(top), thread: Math.round(thread), bottom: Math.round(bottom), head, body, cramped };
}

/* --- 3. Places --------------------------------------------------------------------- */

/** Whether `q` is a place for widget `id` of `size`: on no other widget,
    on nothing blocked, and — when `roomy` — leaving the conversation its
    room. */
function placeTest(items: PlacedWidget[], id: string, size: WidgetSize, page: Page, roomy: boolean) {
  const others = items.filter((x) => x.id !== id && !x.hidden);
  const taken = [...others.map(rectOf), ...(page.blocked ?? [])];
  const boxes = others.map(rectOf);
  const { w, h } = SIZE_PX[size];
  return (q: Position) => {
    const me = { x: q.x, y: q.y, w, h };
    return !taken.some((t) => overlaps(me, t)) && rowOf(me, boxes) <= ROW_MAX && (!roomy || !roomFor([...others, { x: q.x, y: q.y, size }], page).cramped);
  };
}

/** Never more than two widgets in a row (user request): side by side —
    level with each other, less than a widget (`ROW_GAP`) apart — they make a row,
    and a place that would make one of three is refused, on any border. */
const ROW_MAX = 2;
const ROW_GAP = CELL;

/** How many widgets the row of `me` would hold, `me` included. */
function rowOf(me: Rect, boxes: Rect[]): number {
  const beside = (a: Rect, b: Rect) => a.y < b.y + b.h && b.y < a.y + a.h && Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w) < ROW_GAP;
  const row = [me];
  for (let i = 0; i < row.length; i++) for (const b of boxes) if (!row.includes(b) && beside(row[i], b)) row.push(b);
  return row.length;
}

/** The free place nearest to `p` for widget `id` — never on another
    widget (user request), along a border, leaving the conversation its
    room (else at least free); `p` itself when it is. Searched on rings of
    growing distance. */
export function nearestFree(items: PlacedWidget[], id: string, p: Position, size: WidgetSize, page: Page, roomy = true): Position {
  const others = items.filter((x) => x.id !== id && !x.hidden);
  const start = clampPosition(p, size, page.area, others);
  for (const strict of roomy ? [true, false] : [false]) {
    const ok = placeTest(items, id, size, page, strict);
    if (ok(start)) return start;
    const STEP = 8;
    const rings = Math.ceil(Math.max(page.area.width, page.area.height) / STEP);
    for (let ring = 1; ring <= rings; ring++) {
      let best: Position | null = null;
      let bestD = Infinity;
      const seen = new Set<string>();
      for (let i = -ring; i <= ring; i++)
        for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          const q = clampPosition({ x: start.x + dx * STEP, y: start.y + dy * STEP }, size, page.area, others);
          const key = `${q.x},${q.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const d = Math.hypot(q.x - start.x, q.y - start.y);
          if (d < bestD && ok(q)) {
            best = q;
            bestD = d;
          }
        }
      if (best) return best;
    }
  }
  return start;
}

/** The first place for a new widget of `size`: from the top RIGHT (user
    request) down the right side, then down the left side — beside the
    conversation rather than across it —, then along the top and the
    bottom from the right; each leaving the conversation its room. Else
    the nearest place to the top right. */
export function placeWidget(items: PlacedWidget[], size: WidgetSize, page: Page): Position {
  const { area } = page;
  const { w, h } = SIZE_PX[size];
  const step = CELL + GAP;
  const right = area.width - ORIGIN.x - w;
  const spots: Position[] = [];
  for (const x of [right, ORIGIN.x]) for (let y = ORIGIN.y; y <= area.height - EDGE - h; y += step) spots.push({ x, y });
  for (const y of [ORIGIN.x, area.height - ORIGIN.x - h]) for (let x = right - step; x >= EDGE; x -= step) spots.push({ x, y });
  const ok = placeTest(items, "", size, page, true);
  for (const s of spots) if (ok(s)) return s;
  return nearestFree(items, "", { x: right, y: ORIGIN.y }, size, page);
}

/** The places written for the page at `from`, carried to the page now (a
    window resized since): each widget keeps its distance to its own edge
    — and to the bottom when it is in the lower half —, then is clamped
    along a border and moved off any widget or blocked box it now covers;
    the one of a pair after its partner, so it finds its slot again; the
    hidden ones as they are. Deterministic: the same places, page and size
    always give the same answer, so what is shown and what an edit starts
    from never differ. */
export function fitWidgets(items: PlacedWidget[], from: Area | undefined, page: Page): PlacedWidget[] {
  const { area } = page;
  if (area.width <= 0 || area.height <= 0) return items;
  const before = from && from.width > 0 && from.height > 0 ? from : undefined;
  const visible = items.filter((x) => !x.hidden);
  const paired = (it: PlacedWidget) => pairedSide(it, visible, before ?? area) !== null;
  const done: PlacedWidget[] = [];
  for (const it of [...visible.filter((x) => !paired(x)), ...visible.filter(paired)]) {
    const { w, h } = SIZE_PX[it.size];
    let { x, y } = it;
    if (before) {
      const edge = edgeOf(it, before, visible);
      if (edge === "right" || (edge !== "left" && x + w / 2 > before.width / 2)) x += area.width - before.width;
      if (edge === "bottom" || (edge !== "top" && y + h / 2 > before.height / 2)) y += area.height - before.height;
    }
    const p = clampPosition({ x, y }, it.size, area, done);
    done.push({ ...it, ...nearestFree([...done, { ...it, ...p }], it.id, p, it.size, page, false) });
  }
  const fitted = new Map(done.map((x) => [x.id, x]));
  return items.map((x) => fitted.get(x.id) ?? x);
}

/** The list as stored, cleaned: unknown kinds and sizes dropped; a widget
    without a place (the first version kept none) gets the next free one. */
export function readWidgets(raw: unknown): WidgetsState {
  const r = raw as { open?: unknown; items?: unknown; area?: Partial<Area>; off?: unknown } | null;
  const items: PlacedWidget[] = [];
  const fallback: Page = { area: { width: 1400, height: 900 } };
  if (Array.isArray(r?.items))
    for (const x of r.items as unknown[]) {
      const w = x as Partial<PlacedWidget> | null;
      const info = w && typeof w.kind === "string" ? widgetInfo(w.kind as WidgetKind) : undefined;
      if (!w || !info || typeof w.id !== "string" || !w.id) continue;
      const size = info.sizes.includes(w.size as WidgetSize) ? (w.size as WidgetSize) : info.sizes[0];
      const placed = typeof w.x === "number" && typeof w.y === "number" && Number.isFinite(w.x) && Number.isFinite(w.y);
      const at = placed ? { x: w.x!, y: w.y! } : placeWidget(items, size, fallback);
      items.push({ id: w.id, kind: info.kind, size, ...at, ...(w.hidden === true ? { hidden: true } : {}) });
    }
  const a = r?.area;
  const area = typeof a?.width === "number" && typeof a.height === "number" && a.width > 0 && a.height > 0 ? { width: a.width, height: a.height } : undefined;
  const off = Array.isArray(r?.off) ? WIDGETS.map((w) => w.kind).filter((k) => (r.off as unknown[]).includes(k)) : [];
  return { open: r?.open === true, items, ...(area ? { area } : {}), ...(off.length ? { off } : {}) };
}

/* --- Edits (each on the places as shown: `fitWidgets` first) ----------------------- */

/** Added on top, at the first free place. */
export function addWidget(items: PlacedWidget[], w: Omit<PlacedWidget, "x" | "y">, page: Page): PlacedWidget[] {
  const rest = items.filter((x) => x.id !== w.id);
  return [...rest, { ...w, ...placeWidget(rest, w.size, page) }];
}

export const removeWidget = (items: PlacedWidget[], id: string): PlacedWidget[] => items.filter((x) => x.id !== id);

/** Hidden from its right-click menu (user request): kept, with its place,
    but neither drawn nor counted until shown again. */
export const hideWidget = (items: PlacedWidget[], id: string): PlacedWidget[] => items.map((x) => (x.id === id ? { ...x, hidden: true } : x));

/** The hidden widgets shown again, each at its place or the nearest free
    one (the others may have taken it meanwhile). */
export function showHidden(items: PlacedWidget[], page: Page): PlacedWidget[] {
  let out = items;
  for (const it of items) {
    if (!it.hidden) continue;
    const at = nearestFree(out, it.id, it, it.size, page);
    out = out.map((x) => (x.id === it.id ? { id: x.id, kind: x.kind, size: x.size, ...at } : x));
  }
  return out;
}

/** Its size, if the widget has it — moved to the nearest place if it now
    covers another or cramps the conversation. */
export function resizeWidget(items: PlacedWidget[], id: string, size: WidgetSize, page: Page): PlacedWidget[] {
  return items.map((x) => (x.id === id && widgetInfo(x.kind)?.sizes.includes(size) ? { ...x, size, ...nearestFree(items, id, x, size, page) } : x));
}

/** Let go by the hand at `p` (user request): a small widget let go on a
    small one goes right beside it, level with it, on the side the hand
    was (else the other side); otherwise to `p` if it is a place — else the
    nearest one: back within two centimetres of a border, never on another
    widget. On top of the others. */
export function moveWidgetTo(items: PlacedWidget[], id: string, p: Position, page: Page): PlacedWidget[] {
  const w = items.find((x) => x.id === id);
  if (!w) return items;
  let at = (w.size === "small" && besideSmall(items, w, p, page)) || nearestFree(items, id, p, w.size, page);
  /* Tidied: by a border, it lines up on the others there (`ORIGIN.x`
     from that border) when that place is free too. */
  const neat = tidy(at, w.size, page.area);
  if ((neat.x !== at.x || neat.y !== at.y) && placeTest(items, id, w.size, page, true)(neat)) at = neat;
  return [...items.filter((x) => x.id !== id), { ...w, ...at }];
}

/** The same place lined up on its border: `ORIGIN.x` from the edge it is
    within reach of — sides first; a pair's slot is left as it is. */
function tidy(p: Position, size: WidgetSize, area: Area): Position {
  const { w, h } = SIZE_PX[size];
  if (p.x <= REACH) return { x: ORIGIN.x, y: p.y };
  if (area.width - p.x - w <= REACH) return { x: area.width - ORIGIN.x - w, y: p.y };
  if (p.y <= REACH) return { x: p.x, y: ORIGIN.x };
  if (area.height - p.y - h <= REACH) return { x: p.x, y: area.height - ORIGIN.x - h };
  return p;
}

/** Right beside the small widget the small widget `w` is let go on (the
    one it covers most), if one of its two sides is a place. */
function besideSmall(items: PlacedWidget[], w: PlacedWidget, p: Position, page: Page): Position | null {
  const { area } = page;
  const me: Rect = { x: p.x, y: p.y, w: CELL, h: CELL };
  const others = items.filter((x) => x.id !== w.id && !x.hidden);
  let target: PlacedWidget | null = null;
  let most = 0;
  for (const o of others) {
    if (o.size !== "small") continue;
    const r = rectOf(o);
    const cover = Math.max(0, Math.min(me.x + me.w, r.x + r.w) - Math.max(me.x, r.x)) * Math.max(0, Math.min(me.y + me.h, r.y + r.h) - Math.max(me.y, r.y));
    if (cover > most) {
      most = cover;
      target = o;
    }
  }
  if (!target) return null;
  const left = { x: target.x - GAP - CELL, y: target.y };
  const right = { x: target.x + CELL + GAP, y: target.y };
  const ok = placeTest(items, w.id, "small", page, true);
  for (const c of p.x < target.x ? [left, right] : [right, left]) {
    if (c.x < EDGE || c.x + CELL > area.width - EDGE) continue;
    /* A place by the borders' rules (within reach, or a pair's slot). */
    const legal = clampPosition(c, "small", area, others);
    if (legal.x === c.x && legal.y === c.y && ok(c)) return c;
  }
  return null;
}
