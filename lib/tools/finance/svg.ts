/* ---------------------------------------------------------------------------
   Un graphique de marche en SVG, sans dependance.

   Bougies (ou une ligne quand il n'y a que le prix), volume en bas,
   indicateurs superposes, marqueurs d'entree/sortie, niveaux horizontaux,
   graduations rondes. Le SVG est ensuite rasterise en PNG (chart.ts) pour
   le fil et pour le modele. Pur : teste sans disque.
--------------------------------------------------------------------------- */

export type Candle = { time: number; open?: number; high?: number; low?: number; close: number; volume?: number };
export type Overlay = { name: string; values: Array<number | null>; color?: string };
export type Marker = { time: number; price: number; label?: string; kind?: "buy" | "sell" | "note" };
export type HLine = { price: number; label?: string; color?: string };

export type ChartSpec = {
  title: string;
  type: "candles" | "line";
  series: Candle[];
  overlays: Overlay[];
  markers: Marker[];
  hlines: HLine[];
  width: number;
  height: number;
};

const PALETTE = ["#6aa9ff", "#ffb86b", "#c792ea", "#7ee787", "#ff7b72", "#79c0ff"];
const UP = "#3fb950";
const DOWN = "#f85149";
const INK = "#e6edf3";
const MUTED = "#8b949e";
const GRID = "#30363d";
const BG = "#0d1117";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Des graduations rondes (1, 2, 5 × 10^n) couvrant [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; ; v += step) {
    out.push(Number(v.toFixed(10)));
    if (v >= hi || out.length > 50) break;
  }
  return out;
}

const fmtPrice = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
};

const fmtTime = (ms: number, spanMs: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  if (spanMs > 400 * 86400e3) return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}`;
  if (spanMs > 3 * 86400e3) return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function buildChartSvg(spec: ChartSpec): string {
  const { width: W, height: H } = spec;
  const series = spec.series.filter((c) => Number.isFinite(c.close));
  const n = series.length;
  const hasOhlc = spec.type === "candles" && series.every((c) => c.open !== undefined && c.high !== undefined && c.low !== undefined);
  const hasVolume = series.some((c) => (c.volume ?? 0) > 0);
  const padL = 12;
  const padR = 78;
  const padT = 34;
  const padB = 26;
  const volH = hasVolume ? Math.round((H - padT - padB) * 0.18) : 0;
  const plotH = H - padT - padB - volH - (hasVolume ? 8 : 0);
  const plotW = W - padL - padR;

  const lows = series.map((c) => (hasOhlc ? c.low! : c.close));
  const highs = series.map((c) => (hasOhlc ? c.high! : c.close));
  for (const o of spec.overlays) for (const v of o.values) if (v !== null && Number.isFinite(v)) { lows.push(v); highs.push(v); }
  for (const h of spec.hlines) { lows.push(h.price); highs.push(h.price); }
  let lo = Math.min(...lows);
  let hi = Math.max(...highs);
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const margin = (hi - lo) * 0.05;
  lo -= margin;
  hi += margin;

  const x = (i: number) => padL + ((i + 0.5) / Math.max(1, n)) * plotW;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  const slot = plotW / Math.max(1, n);
  const bw = Math.max(1, Math.min(12, slot * 0.66));

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);
  parts.push(`<text x="${padL}" y="20" fill="${INK}" font-size="14" font-weight="600">${esc(spec.title)}</text>`);

  /* Grille et axe des prix. */
  for (const t of niceTicks(lo, hi, 6)) {
    if (t < lo || t > hi) continue;
    const yy = y(t);
    parts.push(`<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${padL + plotW}" y2="${yy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${padL + plotW + 6}" y="${(yy + 4).toFixed(1)}" fill="${MUTED}">${fmtPrice(t)}</text>`);
  }
  /* Axe du temps : ~6 etiquettes. */
  if (n > 1) {
    const span = series[n - 1].time - series[0].time;
    const step = Math.max(1, Math.round(n / 6));
    for (let i = 0; i < n; i += step) {
      parts.push(`<text x="${x(i).toFixed(1)}" y="${H - 8}" fill="${MUTED}" text-anchor="middle">${fmtTime(series[i].time, span)}</text>`);
    }
  }

  /* Volume. */
  if (hasVolume) {
    const vmax = Math.max(...series.map((c) => c.volume ?? 0)) || 1;
    const vy0 = padT + plotH + 8 + volH;
    series.forEach((c, i) => {
      const h = ((c.volume ?? 0) / vmax) * volH;
      const up = hasOhlc ? c.close >= c.open! : i === 0 || c.close >= series[i - 1].close;
      parts.push(`<rect class="volume" x="${(x(i) - bw / 2).toFixed(1)}" y="${(vy0 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up ? UP : DOWN}" opacity="0.45"/>`);
    });
  }

  /* Prix. */
  if (hasOhlc) {
    series.forEach((c, i) => {
      const up = c.close >= c.open!;
      const color = up ? UP : DOWN;
      const cx = x(i);
      const top = y(Math.max(c.open!, c.close));
      const bot = y(Math.min(c.open!, c.close));
      parts.push(`<line class="candle-wick" x1="${cx.toFixed(1)}" y1="${y(c.high!).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(c.low!).toFixed(1)}" stroke="${color}" stroke-width="1"/>`);
      parts.push(`<rect class="candle" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}" fill="${color}"/>`);
    });
  } else {
    const d = series.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`).join(" ");
    parts.push(`<path class="price-line" d="${d}" fill="none" stroke="${PALETTE[0]}" stroke-width="1.6"/>`);
  }

  /* Overlays. */
  spec.overlays.forEach((o, k) => {
    const color = o.color ?? PALETTE[(k + 1) % PALETTE.length];
    let d = "";
    let pen = false;
    o.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v) || i >= n) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    parts.push(`<path class="overlay" d="${d.trim()}" fill="none" stroke="${color}" stroke-width="1.3"/>`);
    parts.push(`<text x="${padL + 4 + k * 90}" y="${padT - 6}" fill="${color}">${esc(o.name)}</text>`);
  });

  /* Niveaux horizontaux. */
  for (const h of spec.hlines) {
    const yy = y(h.price);
    const color = h.color ?? "#d2a8ff";
    parts.push(`<line class="hline" x1="${padL}" y1="${yy.toFixed(1)}" x2="${padL + plotW}" y2="${yy.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="4 3"/>`);
    if (h.label) parts.push(`<text x="${padL + 4}" y="${(yy - 4).toFixed(1)}" fill="${color}">${esc(h.label)}</text>`);
  }

  /* Marqueurs : le point le plus proche dans le temps. */
  for (const m of spec.markers) {
    if (n === 0) break;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(series[i].time - m.time) < Math.abs(series[best].time - m.time)) best = i;
    const cx = x(best);
    const cy = y(m.price);
    const color = m.kind === "sell" ? DOWN : m.kind === "buy" ? UP : "#e3b341";
    const tri = m.kind === "sell" ? `${cx},${cy + 4} ${cx - 5},${cy - 5} ${cx + 5},${cy - 5}` : `${cx},${cy - 4} ${cx - 5},${cy + 5} ${cx + 5},${cy + 5}`;
    parts.push(`<polygon class="marker" points="${tri}" fill="${color}"/>`);
    if (m.label) parts.push(`<text x="${(cx + 7).toFixed(1)}" y="${(cy + 4).toFixed(1)}" fill="${color}">${esc(m.label)}</text>`);
  }

  parts.push("</svg>");
  return parts.join("\n");
}
