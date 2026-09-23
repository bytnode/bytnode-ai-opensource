/* The Watchlist tab's canvases read their colours from the CSS tokens:
   `#rrggbb`, `rgb(…)` or `rgba(…)` → 0..1 channels. */

export type Rgba = [number, number, number, number];

export function parseColor(raw: string, fallback: Rgba): Rgba {
  const s = raw.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (fn) {
    const p = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) return [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1];
  }
  return fallback;
}

/** A colour for a 2D canvas, with its alpha scaled by `alpha`. */
export const css = (c: Rgba, alpha = 1): string => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3] * alpha})`;
