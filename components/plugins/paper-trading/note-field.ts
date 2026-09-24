"use client";

import { useEffect, useRef, type RefObject } from "react";
import { parseColor, type Rgba } from "../watchlist/colors";

/* ---------------------------------------------------------------------------
   The paper portfolio's card, drawn on the GPU (WebGL 2, one fragment
   shader): a banknote under glass. Paper money, said without a word — the
   fine interlaced lines of a note's guilloché, a rosette on the right that
   turns so slowly it reads as still, a sheen crossing the card now and then,
   and, pooled in the lower corner, the result's colour: Apple's green for a
   gain, red for a loss, as deep as the move is large (full at ±10 %).

   The card's ground and its round corners are CSS (`.ptv-card`); this canvas
   lies over the ground, under the figures, and only adds ink. Colours are the
   tokens', re-read when the theme changes. It sleeps with its tab
   (`active`), holds still under `prefers-reduced-motion` (drawn once per
   change), and without WebGL 2 never goes live: the card keeps its CSS wash.
   ⚠️ One context per canvas for life: never lost on purpose (see the
   watchlist's heat field — React's double mount would get a dead one).
--------------------------------------------------------------------------- */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uSize;    // the canvas, in screen px
uniform float uDpr;
uniform float uTime;   // s
uniform float uTone;   // the result, -1..1
uniform float uInkA;   // how much ink the lines take
uniform vec3 uInk;
uniform vec3 uUp;
uniform vec3 uDown;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// A line wherever x crosses a whole number, one device pixel wide.
float lines(float x) {
  float w = fwidth(x);
  float d = abs(fract(x) - 0.5);
  return smoothstep(0.5 - 1.25 * w, 0.5, d);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 uv = px / uSize;
  float t = uTime;

  // The rosette: two families of waved rings, interlaced, on the right.
  vec2 c = vec2(uSize.x * 0.8, uSize.y * 0.52);
  vec2 p = px - c;
  float r = length(p);
  float a = atan(p.y, p.x);
  float ring = r / 9.0;
  float rose = max(lines(ring + 0.85 * sin(a * 12.0 + t * 0.04)), lines(ring - 0.85 * sin(a * 12.0 - t * 0.04 + 1.7)));
  float reach = uSize.y * 0.95;
  rose *= smoothstep(reach, reach * 0.35, r) * 0.95;

  // The note's field: long waved lines across the card, fading leftward.
  float wave = (px.y + 5.0 * sin(px.x / 34.0 + t * 0.07) + 3.0 * sin(px.x / 13.0 - t * 0.05)) / 7.0;
  float field = lines(wave) * (0.25 + 0.45 * uv.x) * 0.55;

  float ink = max(rose, field) * uInkA;

  // Now and then a sheen crosses the card, top-left to bottom-right.
  float sweep = mod(t * 0.035, 2.6) - 0.6;
  float sheen = exp(-pow((uv.x * 0.85 + uv.y * 0.35 - sweep) * 4.5, 2.0)) * 0.06;

  // The result's colour, pooled in the lower right, with a slow tide.
  float mag = clamp(abs(uTone), 0.0, 1.0);
  vec3 tone = uTone >= 0.0 ? uUp : uDown;
  vec2 q = (px - vec2(uSize.x, uSize.y)) / uSize.y;
  float pool = exp(-dot(q, q) * 1.1);
  float tide = noise(vec2(uv.x * 2.2 - t * 0.04, uv.y * 1.8 + t * 0.03));
  float wash = mag * pool * (0.32 + 0.16 * tide);

  // Premultiplied: the ink over the tone's wash.
  float inkA = clamp(ink + sheen, 0.0, 1.0);
  vec3 rgb = tone * wash * (1.0 - inkA) + uInk * inkA;
  float alpha = wash * (1.0 - inkA) + inkA;
  outColor = vec4(rgb, alpha);
}`;

type Field = {
  gl: WebGL2RenderingContext;
  u: Record<string, WebGLUniformLocation | null>;
  colors: { ink: Rgba; up: Rgba; down: Rgba; inkA: number } | null;
  tone: number;
  dirty: boolean;
  lost: boolean;
};

const FIELDS = new WeakMap<HTMLCanvasElement, Field>();
const UNIFORMS = ["uSize", "uDpr", "uTime", "uTone", "uInkA", "uInk", "uUp", "uDown"];

function build(canvas: HTMLCanvasElement): Field | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("Paper trading card: shader not compiled —", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("Paper trading card: program not linked —", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  // One triangle over the whole canvas.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
  return { gl, u, colors: null, tone: 0, dirty: true, lost: false };
}

function readColors(el: HTMLElement): NonNullable<Field["colors"]> {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name);
  const ink = parseColor(`rgb(${v("--ink")})`, [1, 1, 1, 1]);
  /* Light ink (a dark theme) needs less of it to read. */
  const light = ink[0] + ink[1] + ink[2] > 1.5;
  return { ink, up: parseColor(v("--up"), [0.19, 0.82, 0.35, 1]), down: parseColor(v("--down"), [1, 0.27, 0.23, 1]), inkA: light ? 0.075 : 0.1 };
}

/** Frames per second while the card moves: it moves slowly. */
const FPS = 24;

/** `tone`: the result, -1..1 (±10 % and beyond is full). */
export function useNoteField(canvas: RefObject<HTMLCanvasElement | null>, tone: number, active: boolean) {
  const field = useRef<Field | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const f = FIELDS.get(el) ?? build(el);
    if (!f || f.lost) return;
    FIELDS.set(el, f);
    field.current = f;
    el.classList.add("is-live");
    const lost = (e: Event) => {
      e.preventDefault();
      f.lost = true;
      el.classList.remove("is-live");
    };
    el.addEventListener("webglcontextlost", lost);
    const repaint = () => {
      f.colors = null;
      f.dirty = true;
    };
    const theme = new MutationObserver(repaint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", repaint);
    return () => {
      theme.disconnect();
      scheme.removeEventListener("change", repaint);
      el.removeEventListener("webglcontextlost", lost);
      el.classList.remove("is-live");
      field.current = null;
    };
  }, [canvas]);

  useEffect(() => {
    const f = field.current;
    if (!f) return;
    f.tone = Math.max(-1, Math.min(1, tone));
    f.dirty = true;
  }, [tone]);

  useEffect(() => {
    const f = field.current;
    const el = canvas.current;
    if (!active || !f || !el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const resize = new ResizeObserver(() => void (f.dirty = true));
    resize.observe(el);
    const t0 = performance.now();
    let last = 0;
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (f.lost) return;
      const moving = !still.matches;
      if (!f.dirty && (!moving || now - last < 1000 / FPS)) return;
      last = now;
      f.dirty = false;
      /* On screen, zoom included: the bitmap matches the pixels. */
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      f.colors ??= readColors(el);
      const { gl, u, colors } = f;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uSize, rect.width, rect.height);
      gl.uniform1f(u.uDpr, w / Math.max(1, rect.width));
      /* A still card still shows its sheen, where it rests. */
      gl.uniform1f(u.uTime, moving ? 20 + (now - t0) / 1000 : 20);
      gl.uniform1f(u.uTone, f.tone);
      gl.uniform1f(u.uInkA, colors.inkA);
      gl.uniform3f(u.uInk, colors.ink[0], colors.ink[1], colors.ink[2]);
      gl.uniform3f(u.uUp, colors.up[0], colors.up[1], colors.up[2]);
      gl.uniform3f(u.uDown, colors.down[0], colors.down[1], colors.down[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    f.dirty = true;
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [active, canvas]);
}
