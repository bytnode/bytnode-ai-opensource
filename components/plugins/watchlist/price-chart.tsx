"use client";

import { useEffect, useRef } from "react";
import { INTERVAL_MS, type Candle, type Interval } from "@/lib/plugins/shared/candle";
import { decimalsFor, niceTicks, timeLabel, timeStep, timeTicks } from "@/lib/plugins/watchlist/chart-scale";
import { useViewActive } from "../view-activity";
import { css, parseColor, type Rgba } from "./colors";
import { useMessages } from "@/lib/i18n/react";
import { dateTag, numberTag } from "@/lib/i18n/store";

/* ---------------------------------------------------------------------------
   The chosen asset's price, read like Stocks rather than a trading desk:
   one line in the move's colour (green when the span on screen rises, red
   when it falls) over a soft wash of the same colour, a dotted line where
   the span opened, a dot on the last price — and nothing else but a few
   faint levels on the right and the times along the bottom. Under the
   hand, a thin vertical rule, a dot on the line and one small tag: the
   price and the time. Candles, for who wants them, are drawn in the same
   restraint (no volume, no grid of times). The wheel zooms around the
   pointer, a drag pans, a double-click comes back to now.

   One canvas, drawn in 2D — only when something changed and only while
   the tab is in front. The colours are the tokens', re-read when the
   theme changes. Its words and figures are in the interface's language:
   a change of language draws it again.
--------------------------------------------------------------------------- */

export type ChartMode = "line" | "candles";

/** `fit`: the whole series on screen, whatever its length (a period's
    curve, the portfolio's), instead of the trading zoom. `returns`: under
    the curve, a panel of each bar's move against the one before — green
    up, red down, from a zero line, each under its own day. */
type Props = { candles: Candle[] | null; interval: Interval; mode: ChartMode; message: string | null; fit?: boolean; returns?: boolean };

/** Room for the time scale and the hover tag, in CSS px; the price
    scale is as wide as its longest label (`draw` returns it). */
const AXIS_MIN = 56;
const TIME_H = 24;
const TOP = 30;
const BOTTOM_PAD = 6;
/** Empty bars on the right of the last one: room for the last dot. */
const RIGHT_PAD = 2;
const MIN_BARS = 20;
const DEFAULT_BARS = 96;

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

const fmtPrice = (p: number, d: number) => p.toLocaleString(numberTag(), { minimumFractionDigits: d, maximumFractionDigits: d });

/** The visible window: first bar index (may be fractional) and bar width. */
function frame(n: number, view: View, plotW: number) {
  const end = n - 1 + RIGHT_PAD - view.offset;
  const start = end - view.bars + 1;
  return { start, end, barW: plotW / view.bars };
}

function clampView(view: View, n: number, fit = false): View {
  const min = fit ? Math.min(MIN_BARS, n + RIGHT_PAD) : MIN_BARS;
  const bars = Math.max(min, Math.min(Math.max(min, n + RIGHT_PAD), view.bars));
  const offset = Math.max(-bars * 0.5, Math.min(Math.max(0, n - 8), view.offset));
  return { bars, offset };
}

/** Draws the chart; returns the price scale's width (the handlers need
    the plot's). `returnsLabel`: the returns panel's title. */
function draw(canvas: HTMLCanvasElement, data: Candle[], interval: Interval, mode: ChartMode, view: View, hover: { x: number; y: number } | null, pal: Palette, returns = false, returnsLabel = ""): number {
  /* Drawn in the canvas's CSS pixels; the bitmap follows its size ON
     SCREEN — a zoomed view (90 %) shows it smaller, and a bitmap of its
     CSS size would be scaled down, blurred. */
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 10 || H < 10) return AXIS_MIN;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * (canvas.getBoundingClientRect().width / W || 1);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext("2d");
  if (!g) return AXIS_MIN;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const n = data.length;
  if (!n) return AXIS_MIN;

  /** A line on the pixel grid. */
  const px = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
  /* The returns' panel, when asked: under the curve, above the times. */
  const panelH = returns ? Math.round(Math.min(96, Math.max(56, H * 0.24))) : 0;
  const panelGap = returns ? 46 : 0;
  const bottom = H - TIME_H - BOTTOM_PAD - panelH - panelGap;
  const plotH = bottom - TOP;
  const panelTop = bottom + panelGap;
  const zero = panelTop + panelH / 2;
  /* Which bars are on screen does not depend on the width: the scale is
     measured once the levels are known, then the plot takes the rest. */
  const { start, end } = frame(n, view, 1);
  const first = Math.max(0, Math.floor(start));
  const last = Math.min(n - 1, Math.ceil(end));
  const shown = data.slice(first, last + 1);
  if (!shown.length) return AXIS_MIN;

  let lo = Math.min(...shown.map((c) => (mode === "line" ? c.c : c.l)));
  let hi = Math.max(...shown.map((c) => (mode === "line" ? c.c : c.h)));
  const pad = (hi - lo || hi * 0.01 || 1) * 0.1;
  lo -= pad;
  hi += pad;
  const y = (p: number) => TOP + ((hi - p) / (hi - lo)) * plotH;
  const { step, ticks } = niceTicks(lo, hi, Math.max(2, Math.round(plotH / 70)));
  const dec = decimalsFor(data[n - 1].c, step);
  const font = (size: number, weight = 400) => `${weight} ${size}px ${pal.font}`;
  g.font = font(11.5, 650);
  const axisW = Math.max(AXIS_MIN, Math.ceil(Math.max(...[...ticks, data[n - 1].c].map((t) => g.measureText(fmtPrice(t, dec)).width))) + 24);
  const plotW = W - axisW;
  const barW = plotW / view.bars;
  const x = (i: number) => (i - start + 0.5) * barW;

  /* The span's colour: its first close against its last. */
  const open = shown[0].c;
  const close = shown[shown.length - 1].c;
  const tone = close >= open ? pal.up : pal.down;

  /* A few faint levels. */
  g.lineWidth = 1 / dpr;
  g.strokeStyle = css(pal.ink, 0.06);
  g.beginPath();
  for (const t of ticks) {
    g.moveTo(0, px(y(t)));
    g.lineTo(plotW, px(y(t)));
  }
  g.stroke();

  g.save();
  g.beginPath();
  g.rect(0, 0, plotW, H);
  g.clip();

  /* Where the span opened: a dotted line across. */
  g.setLineDash([1.5, 4]);
  g.strokeStyle = css(pal.ink, 0.3);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(0, px(y(open)));
  g.lineTo(plotW, px(y(open)));
  g.stroke();
  g.setLineDash([]);

  if (mode === "line") {
    /* The line, over a wash that fades to nothing at the bottom. */
    g.beginPath();
    for (let i = first; i <= last; i++) (i === first ? g.moveTo : g.lineTo).call(g, x(i), y(data[i].c));
    const wash = g.createLinearGradient(0, TOP, 0, bottom);
    wash.addColorStop(0, css(tone, 0.26));
    wash.addColorStop(1, css(tone, 0));
    g.save();
    g.lineTo(x(last), bottom);
    g.lineTo(x(first), bottom);
    g.closePath();
    g.fillStyle = wash;
    g.fill();
    g.restore();
    g.beginPath();
    for (let i = first; i <= last; i++) (i === first ? g.moveTo : g.lineTo).call(g, x(i), y(data[i].c));
    g.strokeStyle = css(tone);
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.stroke();
  } else {
    const body = Math.max(1, Math.min(barW * 0.64, barW - 1.5));
    for (let i = first; i <= last; i++) {
      const c = data[i];
      const t = c.c >= c.o ? pal.up : pal.down;
      g.strokeStyle = css(t);
      g.fillStyle = css(t);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px(x(i)), y(c.h));
      g.lineTo(px(x(i)), y(c.l));
      g.stroke();
      const top = y(Math.max(c.o, c.c));
      g.beginPath();
      g.roundRect(x(i) - body / 2, top, body, Math.max(1, y(Math.min(c.o, c.c)) - top), Math.min(1.5, body / 3));
      g.fill();
    }
  }

  /* The last price: a dot, with a soft halo, when it is on screen. */
  const lastC = data[n - 1];
  const lx = x(n - 1);
  const ly = y(lastC.c);
  if (mode === "line" && lx >= 0 && lx <= plotW) {
    g.fillStyle = css(tone, 0.22);
    g.beginPath();
    g.arc(lx, ly, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = css(tone);
    g.beginPath();
    g.arc(lx, ly, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  /* The returns: a bar a day from the zero line, scaled on the largest
     move on screen. */
  /* In the returns' panel a bar's `v` is the money put in or taken out
     that day (the portfolio's series), taken off the move — counted half
     in the base, as the portfolio's figures do (Modified Dietz). */
  const moveAt = (i: number) => {
    if (i < 1) return undefined;
    const before = data[i - 1].c;
    const flow = data[i].v || 0;
    const base = before + flow / 2;
    return (before > 0 || flow > 0) && base > 0 ? ((data[i].c - before - flow) / base) * 100 : undefined;
  };
  let maxMove = 0;
  if (returns) {
    for (let i = first; i <= last; i++) maxMove = Math.max(maxMove, Math.abs(moveAt(i) ?? 0));
    maxMove ||= 1;
    g.strokeStyle = css(pal.ink, 0.16);
    g.lineWidth = 1 / dpr;
    g.beginPath();
    g.moveTo(0, px(zero));
    g.lineTo(plotW, px(zero));
    g.stroke();
    const w = Math.max(1, Math.min(barW * 0.62, barW - 1));
    for (let i = first; i <= last; i++) {
      const m = moveAt(i);
      if (m === undefined) continue;
      const h = Math.max(1, (Math.abs(m) / maxMove) * (panelH / 2 - 3));
      g.fillStyle = css(m >= 0 ? pal.up : pal.down);
      g.beginPath();
      g.roundRect(x(i) - w / 2, m >= 0 ? zero - h : zero, w, h, Math.min(1.5, w / 3));
      g.fill();
    }
  }
  g.restore();

  if (returns) {
    g.font = font(11.5, 600);
    g.fillStyle = css(pal.ink, 0.55);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(returnsLabel, 0, panelTop - 12);
    g.font = font(11);
    g.fillStyle = css(pal.ink, 0.45);
    g.textBaseline = "middle";
    g.fillText(`+${fmtPrice(maxMove, 1)} %`, plotW + 12, panelTop + 5);
    g.fillText("0", plotW + 12, zero);
    g.fillText(`−${fmtPrice(maxMove, 1)} %`, plotW + 12, panelTop + panelH - 5);
  }

  /* The levels on the right, the times along the bottom; the last price
     in its colour on the scale, the levels too close to it left out. */
  g.font = font(11.5);
  g.fillStyle = css(pal.ink, 0.45);
  g.textBaseline = "middle";
  g.textAlign = "left";
  const lastOnScale = ly > TOP - 6 && ly < bottom + 6;
  for (const t of ticks) if (y(t) > TOP - 6 && y(t) < bottom + 6 && (!lastOnScale || Math.abs(y(t) - ly) > 16)) g.fillText(fmtPrice(t, dec), plotW + 12, y(t));
  if (lastOnScale) {
    g.font = font(11.5, 650);
    g.fillStyle = css(tone);
    g.fillText(fmtPrice(lastC.c, dec), plotW + 12, ly);
  }
  const span = INTERVAL_MS[interval];
  const t0 = data[0].t;
  const iOf = (t: number) => (t - t0) / span;
  const times = timeTicks(t0 + start * span, t0 + end * span, timeStep(span, barW, 110));
  g.font = font(11.5);
  g.fillStyle = css(pal.ink, 0.45);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (const t of times) {
    const tx = x(iOf(t));
    if (tx > 28 && tx < plotW - 28) g.fillText(timeLabel(t, dateTag()), tx, H - 7);
  }

  /* Under the hand: a thin rule, a dot on the price, one tag above. */
  if (hover && hover.x >= 0 && hover.x < plotW && hover.y > 0 && hover.y < H) {
    const i = Math.max(first, Math.min(last, Math.round(start + hover.x / barW - 0.5)));
    const c = data[i];
    const hx = x(i);
    g.strokeStyle = css(pal.ink, 0.28);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px(hx), TOP - 4);
    g.lineTo(px(hx), returns ? panelTop + panelH : bottom);
    g.stroke();
    const hy = y(c.c);
    g.fillStyle = css(pal.inv);
    g.beginPath();
    g.arc(hx, hy, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = css(c.c >= open ? pal.up : pal.down);
    g.beginPath();
    g.arc(hx, hy, 3.5, 0, Math.PI * 2);
    g.fill();
    const when = new Date(c.t).toLocaleString(dateTag(), interval === "1d" ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const m = returns ? moveAt(i) : undefined;
    const text = `${fmtPrice(c.c, dec)}   ${when}${m !== undefined ? `   ${m >= 0 ? "+" : "−"}${fmtPrice(Math.abs(m), 2)} %` : ""}`;
    g.font = font(12, 600);
    const w = g.measureText(text).width + 20;
    const left = Math.max(0, Math.min(plotW - w, hx - w / 2));
    g.fillStyle = css(pal.ink, 0.1);
    g.beginPath();
    g.roundRect(left, 2, w, 22, 11);
    g.fill();
    g.fillStyle = css(pal.ink, 0.9);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, left + 10, 13.5);
  }
  return axisW;
}

export function PriceChart({ candles, interval, mode, message, fit = false, returns = false }: Props) {
  const words = useMessages().watchlist.chart;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ data: [] as Candle[], interval, mode, view: { bars: DEFAULT_BARS, offset: 0 } as View, hover: null as { x: number; y: number } | null, palette: null as Palette | null, axisW: AXIS_MIN, fit: false, returns: false, returnsLabel: "", frame: 0, drag: null as { x: number; offset: number } | null });
  const active = useViewActive();

  /* The data: redrawn when it changes. A series that arrives (a new asset,
     a new interval) starts at now, at the default zoom — never clamped on
     the empty series of the loading. */
  useEffect(() => {
    const s = state.current;
    const data = candles ?? [];
    if (data.length && (!s.data.length || s.interval !== interval || (fit && data.length !== s.data.length))) s.view = { bars: fit ? data.length + RIGHT_PAD : DEFAULT_BARS, offset: 0 };
    s.interval = interval;
    s.mode = mode;
    s.fit = fit;
    s.returns = returns;
    s.returnsLabel = words.dailyReturns;
    s.data = data;
    if (data.length) s.view = clampView(s.view, data.length, fit);
    const el = canvas.current;
    if (el && s.palette) s.axisW = draw(el, s.data, s.interval, s.mode, s.view, s.hover, s.palette, s.returns, s.returnsLabel);
  }, [candles, interval, mode, fit, returns, words]);

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
        s.axisW = draw(el, s.data, s.interval, s.mode, s.view, s.hover, s.palette, s.returns, s.returnsLabel);
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

    /* The pointer, in the canvas's CSS pixels (a zoomed view divides). */
    const at = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      const z = r.width / (el.clientWidth || r.width) || 1;
      return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z, w: r.width / z - s.axisW };
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
      const next = clampView({ bars, offset: 0 }, n, s.fit);
      const newStart = anchor - f * next.bars;
      s.view = clampView({ bars: next.bars, offset: n - 1 + RIGHT_PAD - (newStart + next.bars - 1) }, n, s.fit);
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
        const z = el.getBoundingClientRect().width / (el.clientWidth || 1) || 1;
        s.view = clampView({ bars: s.view.bars, offset: s.drag.offset + (e.clientX - s.drag.x) / z / barW }, s.data.length, s.fit);
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
      s.view = clampView({ bars: s.fit ? s.data.length + RIGHT_PAD : DEFAULT_BARS, offset: 0 }, s.data.length, s.fit);
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
      <canvas className="wlv-chart-canvas" ref={canvas} role="img" aria-label={words.label} />
      {message && <p className="wlv-chart-message">{message}</p>}
    </div>
  );
}
