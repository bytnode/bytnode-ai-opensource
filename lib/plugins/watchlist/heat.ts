import type { Quote } from "../shared/quote";

/* ---------------------------------------------------------------------------
   The Watchlist tab's arithmetic: which change a window reads, how hot a
   move is on that window's scale, where the tiles' grid has its outer
   corners, and the order of the list.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Window = "1h" | "4h" | "24h" | "7d";

export const WINDOWS: Array<{ value: Window; label: string }> = [
  { value: "1h", label: "1 h" },
  { value: "4h", label: "4 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
];

/** The move, in %, that reads as fully hot on each window: an hour does
    not move like a week. */
export const HEAT_SCALE: Record<Window, number> = { "1h": 2, "4h": 4, "24h": 8, "7d": 20 };

/** The change of a quote over a window, in %, or undefined. */
export function changeOf(quote: Quote | null | undefined, window: Window): number | undefined {
  if (!quote) return undefined;
  const v = window === "1h" ? quote.change1h : window === "4h" ? quote.change4h : window === "24h" ? quote.change24h : quote.change7d;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** How hot a change is, from -1 (a full fall) to 1 (a full rise), on the
    window's scale — eased so that small moves still show. 0 when unknown. */
export function heatOf(change: number | undefined, window: Window): number {
  if (change === undefined || !Number.isFinite(change) || change === 0) return 0;
  const m = Math.min(1, Math.abs(change) / HEAT_SCALE[window]) ** 0.75;
  return change > 0 ? m : -m;
}

/** The corners of a tile that are the grid's own (bit set: 1 top-left,
    2 top-right, 4 bottom-left, 8 bottom-right). Only those are round; an
    incomplete last row leaves the row above it a bottom-right corner. */
export const CORNER = { tl: 1, tr: 2, bl: 4, br: 8 } as const;

export function outerCorners(i: number, count: number, cols: number): number {
  if (i < 0 || i >= count || cols < 1) return 0;
  const rows = Math.ceil(count / cols);
  const row = Math.floor(i / cols);
  const col = i % cols;
  const lastInRow = col === cols - 1 || i === count - 1;
  const lastRowShort = count % cols !== 0;
  let bits = 0;
  if (i === 0) bits |= CORNER.tl;
  if (row === 0 && lastInRow) bits |= CORNER.tr;
  if (col === 0 && row === rows - 1) bits |= CORNER.bl;
  if (i === count - 1 || (lastRowShort && row === rows - 2 && col === cols - 1)) bits |= CORNER.br;
  return bits;
}

/** The list in the user's order, or by the size of the move over the
    window (the unknown ones last, in the user's order). */
export function sortByMove<T extends { quote: Quote | null }>(rows: T[], window: Window, byMove: boolean): T[] {
  if (!byMove) return rows;
  return rows
    .map((r, i) => ({ r, i, c: changeOf(r.quote, window) }))
    .sort((a, b) => (a.c === undefined ? (b.c === undefined ? a.i - b.i : 1) : b.c === undefined ? -1 : Math.abs(b.c) - Math.abs(a.c) || a.i - b.i))
    .map((x) => x.r);
}
