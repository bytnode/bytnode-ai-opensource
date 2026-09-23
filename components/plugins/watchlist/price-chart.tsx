"use client";

import { useEffect, useRef } from "react";
import { INTERVAL_MS, type Candle, type Interval } from "@/lib/plugins/shared/candle";
import { decimalsFor, niceTicks, timeLabel, timeStep, timeTicks } from "@/lib/plugins/watchlist/chart-scale";
import { useViewActive } from "../view-activity";
import { css, parseColor, type Rgba } from "./colors";

/* ---------------------------------------------------------------------------
   The chosen asset's price, as a trader reads it: candles in Apple's green
   and red, the volume faint underneath, the price scale on the right and
   the time along the bottom, the last price as a dashed line with its tag
   on the scale — and under the hand, a crosshair, the bar's open / high /
   low / close and move in the top-left corner. The wheel zooms around the
   pointer, a drag pans, a double-click comes back to now.

   One canvas, drawn in 2D (crisp lines, text) — only when something
   changed and only while the tab is in front. The colours are the
   tokens', re-read when the theme changes.
--------------------------------------------------------------------------- */

type Props = { candles: Candle[] | null; interval: Interval; message: string | null };

/** Room for the price scale, the time scale and the legend, in CSS px. */
const AXIS_W = 76;
const TIME_H = 28;
const TOP = 34;
/** The volume's share of the plot's height. */
const VOLUME = 0.16;
/** Empty bars on the right of the last one, like a trading chart. */
const RIGHT_PAD = 4;
const MIN_BARS = 20;
const DEFAULT_BARS = 110;

type View = { bars: number; offset: number };
type Palette = { up: Rgba; down: Rgba; ink: Rgba; inv: Rgba; font: string };

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n);
  return {
    up: parseColor(v("--up"), [0.19, 0.82, 0.35, 1]),
    down: parseColor(v("--down"), [1, 0.27, 0.23, 1]),
    ink: parseColor(`rgb(${v("--ink")})`, [1, 1, 1, 1]),
    inv: parseColor(`rgb(${v("--ink-inv")})`, [0, 0, 0, 1]),
    font: cs.fontFamily,
  };
}

const fmtPrice = (p: number, d: number) => p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** The visible window: first bar index (may be fractional) and bar width. */
function frame(n: number, view: View, plotW: number) {
  const end = n - 1 + RIGHT_PAD - view.offset;
  const start = end - view.bars + 1;
  return { start, end, barW: plotW / view.bars };
}

function clampView(view: View, n: number): View {
  const bars = Math.max(MIN_BARS, Math.min(Math.max(MIN_BARS, n + RIGHT_PAD), view.bars));
  const offset = Math.max(-bars * 0.5, Math.min(Math.max(0, n - 8), view.offset));
  return { bars, offset };
}

function draw(canvas: HTMLCanvasElement, data: Candle[], interval: Interval, view: View, hover: { x: number; y: number } | null, pal: Palette) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 10 || H < 10) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const n = data.length;
  if (!n) return;

  /** A line on the pixel grid. */
  const px = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
  const plotW = W - AXIS_W;
  const plotH = H - TOP - TIME_H;
  const priceH = plotH * (1 - VOLUME) - 8;
  const { start, end, barW } = frame(n, view, plotW);
  const x = (i: number) => (i - start + 0.5) * barW;
  const first = Math.max(0, Math.floor(start));
  const last = Math.min(n - 1, Math.ceil(end));
  const shown = data.slice(first, last + 1);
  if (!shown.length) return;

  let lo = Math.min(...shown.map((c) => c.l));
  let hi = Math.max(...shown.map((c) => c.h));
  const pad = (hi - lo || hi * 0.01 || 1) * 0.08;
  lo -= pad;
  hi += pad;
  const y = (p: number) => TOP + ((hi - p) / (hi - lo)) * priceH;
  const priceAt = (py: number) => hi - ((py - TOP) / priceH) * (hi - lo);
  const { step, ticks } = niceTicks(lo, hi, Math.max(3, Math.round(priceH / 56)));
  const dec = decimalsFor(data[n - 1].c, step);
  const vMax = Math.max(1, ...shown.map((c) => c.v));
  const volTop = TOP + plotH * (1 - VOLUME);
  const font = (size: number, weight = 400) => `${weight} ${size}px ${pal.font}`;

  /* The grid: faint levels and times. */
  g.lineWidth = 1 / dpr;
  g.strokeStyle = css(pal.ink, 0.06);
  g.beginPath();
  for (const t of ticks) {
    g.moveTo(0, px(y(t)));
    g.lineTo(plotW, px(y(t)));
  }
  const span = INTERVAL_MS[interval];
  const t0 = data[0].t;
  const iOf = (t: number) => (t - t0) / span;
  const tStep = timeStep(span, barW, 96);
  const times = timeTicks(t0 + start * span, t0 + end * span, tStep);
  for (const t of times) {
    g.moveTo(px(x(iOf(t))), TOP - 10);
    g.lineTo(px(x(iOf(t))), TOP + plotH);
  }
  g.stroke();

  /* The volume, then the candles. */
  const body = Math.max(1, Math.min(barW * 0.72, barW - 1));
  g.save();
  g.beginPath();
  g.rect(0, 0, plotW, H);
  g.clip();
  for (let i = first; i <= last; i++) {
    const c = data[i];
    const tone = c.c >= c.o ? pal.up : pal.down;
    const h = (c.v / vMax) * (plotH * VOLUME - 4);
    g.fillStyle = css(tone, 0.22);
    g.fillRect(x(i) - body / 2, TOP + plotH - h, body, h);
  }
  for (let i = first; i <= last; i++) {
    const c = data[i];
    const tone = c.c >= c.o ? pal.up : pal.down;
    g.strokeStyle = css(tone);
    g.fillStyle = css(tone);
    g.beginPath();
    g.moveTo(px(x(i)), y(c.h));
    g.lineTo(px(x(i)), y(c.l));
    g.lineWidth = Math.max(1, Math.min(1.5, barW * 0.12));
    g.stroke();
    const top = y(Math.max(c.o, c.c));
    g.fillRect(x(i) - body / 2, top, body, Math.max(1, y(Math.min(c.o, c.c)) - top));
  }
  g.restore();

  /* The price scale and the time scale. */
  g.font = font(11.5);
  g.fillStyle = css(pal.ink, 0.5);
  g.textBaseline = "middle";
  g.textAlign = "left";
  for (const t of ticks) if (y(t) > TOP - 4 && y(t) < volTop) g.fillText(fmtPrice(t, dec), plotW + 10, y(t));
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (const t of times) {
    const tx = x(iOf(t));
    if (tx > 24 && tx < plotW - 24) g.fillText(timeLabel(t), tx, H - 9);
  }

  const tag = (text: string, cx: number, cy: number, fill: string, color: string, align: "left" | "center") => {
    g.font = font(11.5, 600);
    const w = g.measureText(text).width + 14;
    const left = align === "left" ? cx : cx - w / 2;
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(left, cy - 10, w, 20, 6);
    g.fill();
    g.fillStyle = color;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, left + 7, cy + 0.5);
  };

  /* The last price: a dashed line across, its tag on the scale. */
  const lastC = data[n - 1];
  const lastTone = lastC.c >= (data[n - 2]?.c ?? lastC.o) ? pal.up : pal.down;
  const ly = y(lastC.c);
  if (ly > TOP - 10 && ly < volTop) {
    g.setLineDash([2, 3]);
    g.strokeStyle = css(lastTone, 0.9);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, px(ly));
    g.lineTo(plotW, px(ly));
    g.stroke();
    g.setLineDash([]);
    tag(fmtPrice(lastC.c, dec), plotW + 4, ly, css(lastTone), "#fff", "left");
  }

  /* Under the hand: the crosshair, snapped on the bar; its tags. */
  let focus = lastC;
  let focusPrev = data[n - 2];
  if (hover && hover.x < plotW && hover.y > TOP - 10 && hover.y < TOP + plotH) {
    const i = Math.round(start + hover.x / barW - 0.5);
    const hx = x(i);
    g.setLineDash([4, 4]);
    g.strokeStyle = css(pal.ink, 0.35);
    g.lineWidth = 1 / dpr;
    g.beginPath();
    g.moveTo(px(hx), TOP - 10);
    g.lineTo(px(hx), TOP + plotH);
    g.moveTo(0, px(hover.y));
    g.lineTo(plotW, px(hover.y));
    g.stroke();
    g.setLineDash([]);
    if (hover.y < volTop) tag(fmtPrice(priceAt(hover.y), dec), plotW + 4, hover.y, css(pal.ink, 0.92), css(pal.inv), "left");
    const t = t0 + i * span;
    tag(new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), Math.min(plotW - 60, Math.max(60, hx)), H - 13, css(pal.ink, 0.92), css(pal.inv), "center");
    if (data[i]) {
      focus = data[i];
      focusPrev = data[i - 1];
    }
  }

  /* The legend: the bar's open, high, low, close and move. */
  const move = focusPrev ? ((focus.c - focusPrev.c) / focusPrev.c) * 100 : ((focus.c - focus.o) / focus.o) * 100;
  const tone = css(focus.c >= focus.o ? pal.up : pal.down);
  let lx = 2;
  g.textAlign = "left";
  g.textBaseline = "middle";
  const part = (label: string, value: string, color: string) => {
    g.font = font(12.5, 500);
    g.fillStyle = css(pal.ink, 0.5);
    g.fillText(label, lx, 13);
    lx += g.measureText(label).width + 5;
    g.font = font(12.5, 600);
    g.fillStyle = color;
    g.fillText(value, lx, 13);
    lx += g.measureText(value).width + 14;
  };
  part("O", fmtPrice(focus.o, dec), tone);
  part("H", fmtPrice(focus.h, dec), tone);
  part("L", fmtPrice(focus.l, dec), tone);
  part("C", fmtPrice(focus.c, dec), tone);
  if (lx < plotW - 60) part("", `${move >= 0 ? "+" : "−"}${Math.abs(move).toFixed(2)} %`, tone);
}

export function PriceChart({ candles, interval, message }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ data: [] as Candle[], interval, view: { bars: DEFAULT_BARS, offset: 0 } as View, hover: null as { x: number; y: number } | null, palette: null as Palette | null, frame: 0, drag: null as { x: number; offset: number } | null });
  const active = useViewActive();

  /* The data: redrawn when it changes. A series that arrives (a new asset,
     a new interval) starts at now, at the default zoom — never clamped on
     the empty series of the loading. */
  useEffect(() => {
    const s = state.current;
    const data = candles ?? [];
    if (data.length && (!s.data.length || s.interval !== interval)) s.view = { bars: DEFAULT_BARS, offset: 0 };
    s.interval = interval;
    s.data = data;
    if (data.length) s.view = clampView(s.view, data.length);
    const el = canvas.current;
    if (el && s.palette) draw(el, s.data, s.interval, s.view, s.hover, s.palette);
  }, [candles, interval]);

  /* The canvas's life while the tab is in front: size, theme, the hand. */
  useEffect(() => {
    const el = canvas.current;
    const wrap = box.current;
    if (!active || !el || !wrap) return;
    const s = state.current;
    const paint = () => {
      cancelAnimationFrame(s.frame);
      s.frame = requestAnimationFrame(() => {
        s.palette ??= readPalette(wrap);
        draw(el, s.data, s.interval, s.view, s.hover, s.palette);
      });
    };
    const retheme = () => {
      s.palette = null;
      paint();
    };
    const resize = new ResizeObserver(paint);
    resize.observe(el);
    const theme = new MutationObserver(retheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", retheme);

    const at = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width - AXIS_W };
    };
    /* The wheel zooms around the bar under the pointer. */
    const wheel = (e: WheelEvent) => {
      if (!s.data.length) return;
      e.preventDefault();
      const p = at(e);
      const n = s.data.length;
      const f = Math.max(0, Math.min(1, p.x / p.w));
      const { start } = frame(n, s.view, p.w);
      const anchor = start + f * s.view.bars;
      const bars = Math.round(s.view.bars * Math.exp(e.deltaY * 0.0015));
      const next = clampView({ bars, offset: 0 }, n);
      const newStart = anchor - f * next.bars;
      s.view = clampView({ bars: next.bars, offset: n - 1 + RIGHT_PAD - (newStart + next.bars - 1) }, n);
      paint();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      s.drag = { x: e.clientX, offset: s.view.offset };
      el.classList.add("is-dragging");
    };
    const move = (e: PointerEvent) => {
      const p = at(e);
      s.hover = { x: p.x, y: p.y };
      if (s.drag) {
        const barW = p.w / s.view.bars;
        s.view = clampView({ bars: s.view.bars, offset: s.drag.offset + (e.clientX - s.drag.x) / barW }, s.data.length);
      }
      paint();
    };
    const up = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      s.drag = null;
      el.classList.remove("is-dragging");
    };
    const leave = () => {
      if (s.drag) return;
      s.hover = null;
      paint();
    };
    const reset = () => {
      s.view = clampView({ bars: DEFAULT_BARS, offset: 0 }, s.data.length);
      paint();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("dblclick", reset);
    paint();
    return () => {
      cancelAnimationFrame(s.frame);
      resize.disconnect();
      theme.disconnect();
      scheme.removeEventListener("change", retheme);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("dblclick", reset);
    };
  }, [active]);

  return (
    <div className="wlv-chart" ref={box}>
      <canvas className="wlv-chart-canvas" ref={canvas} role="img" aria-label="Price chart — scroll to zoom, drag to pan, double-click to come back to now" />
      {message && <p className="wlv-chart-message">{message}</p>}
    </div>
  );
}
