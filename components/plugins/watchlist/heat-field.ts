"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { outerCorners } from "@/lib/plugins/watchlist/heat";
import { parseColor, type Rgba } from "./colors";

/* ---------------------------------------------------------------------------
   The heat map's ground, drawn on the GPU (WebGL 2, one fragment shader).

   The tiles are laid out by CSS (a grid of equal tiles, 2 px apart) and
   carry their text; this canvas lies under them and paints what CSS
   cannot: each tile washed in Apple's green or red by the size of its
   move on the chosen window, the wash pooled on the move's side — the top
   for a rise, the bottom for a fall — and a slow tide in it, drifting up
   or down with the move. Only the grid's outer corners are round (the
   corner bits come from `outerCorners`, once the tiles per row are
   measured); the inner ones are square.

   Geometry is measured, not assumed: the first tile's box, the gap to the
   second, the tiles per row. Colours are read from the CSS tokens and
   re-read when the theme changes. It sleeps with its tab (`active`), and
   holds still under `prefers-reduced-motion` — drawn once per change.
   Without WebGL 2 the canvas never goes live and the tiles keep their CSS
   ground (`.wlv-heat:has(canvas.is-live)` is what hides it).
--------------------------------------------------------------------------- */

export type HeatTile = { heat: number; selected: boolean };

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uSize;       // the canvas, in CSS px
uniform float uDpr;
uniform float uTime;      // s
uniform vec2 uOrigin;     // the first tile's top-left, CSS px
uniform vec2 uTile;       // a tile's size, CSS px
uniform float uGap;
uniform float uRadius;
uniform int uCols;
uniform int uCount;
uniform vec3 uInk;
uniform float uTileAlpha;
uniform vec3 uUp;
uniform vec3 uDown;
uniform sampler2D uData;  // one texel per tile: heat, flags, corners

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

// A box with a radius per corner (r: top-right, bottom-right, top-left,
// bottom-left), y up — Inigo Quilez's sdRoundBox.
float sdBox(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x = (p.y > 0.0) ? r.x : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr - uOrigin;
  vec2 pitch = uTile + uGap;
  vec2 cell = floor(css / pitch);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= float(uCols)) discard;
  int i = int(cell.y) * uCols + int(cell.x);
  if (i >= uCount) discard;
  vec2 local = css - cell * pitch;
  if (local.x > uTile.x + 0.5 || local.y > uTile.y + 0.5) discard;

  vec4 d = texelFetch(uData, ivec2(i, 0), 0);
  int flags = int(d.g * 255.0 + 0.5);
  int corners = int(d.b * 255.0 + 0.5);
  vec4 r = vec4(
    (corners & 2) != 0 ? uRadius : 0.0,
    (corners & 8) != 0 ? uRadius : 0.0,
    (corners & 1) != 0 ? uRadius : 0.0,
    (corners & 4) != 0 ? uRadius : 0.0
  );
  vec2 c = local - uTile * 0.5;
  c.y = -c.y;
  float dist = sdBox(c, uTile * 0.5, r);
  float edge = 0.5 / uDpr;
  float mask = 1.0 - smoothstep(-edge, edge, dist);
  if (mask <= 0.0) discard;

  float heat = (d.r * 255.0 - 128.0) / 127.0;
  float mag = abs(heat);
  float rising = step(0.0, heat);
  vec3 tone = mix(uDown, uUp, rising);
  vec2 uv = local / uTile;
  // The move's side: a rise gathers at the top, a fall at the bottom.
  float side = mix(uv.y, 1.0 - uv.y, rising);
  float dir = mix(-1.0, 1.0, rising);
  float tide = noise(vec2(uv.x * 2.4 + cell.x * 7.0, uv.y * 1.6 + dir * uTime * 0.12 + cell.y * 3.0));
  float ripple = noise(vec2(uv.x * 5.0 - uTime * 0.03 + cell.y, uv.y * 3.5 + dir * uTime * 0.2));
  float wash = mag * (0.14 + 0.46 * side * side) * (0.8 + 0.35 * tide + 0.15 * ripple);

  bool selected = (flags & 1) != 0;
  bool hovered = (flags & 2) != 0;
  float ground = uTileAlpha + (hovered ? 0.035 : 0.0) + (selected ? 0.045 : 0.0);

  // Premultiplied: the tone over the tile's own ground.
  vec3 rgb = tone * wash + uInk * ground * (1.0 - wash);
  float a = wash + ground * (1.0 - wash);
  if (selected) {
    float ring = (1.0 - smoothstep(1.5, 2.5, -dist)) * 0.85;
    rgb = uInk * ring + rgb * (1.0 - ring);
    a = ring + a * (1.0 - ring);
  }
  outColor = vec4(rgb, a) * mask;
}`;

type Field = {
  gl: WebGL2RenderingContext;
  u: Record<string, WebGLUniformLocation | null>;
  tex: WebGLTexture;
  data: Uint8Array;
  count: number;
  /** Tiles per row, as last measured (0: not yet). */
  cols: number;
  hover: number;
  tiles: HeatTile[];
  colors: { ink: Rgba; tile: Rgba; up: Rgba; down: Rgba } | null;
  dirty: boolean;
  lost: boolean;
};

/* One field per canvas, kept across a remount. ⚠️ A canvas has only ONE
   WebGL context for its life: losing it on unmount (React mounts every
   effect twice in development) would hand the next mount a dead context,
   whose shaders never compile. So the context is never lost on purpose —
   it goes with its canvas — and a remount takes the field back. */
const FIELDS = new WeakMap<HTMLCanvasElement, Field>();

const UNIFORMS = ["uSize", "uDpr", "uTime", "uOrigin", "uTile", "uGap", "uRadius", "uCols", "uCount", "uInk", "uTileAlpha", "uUp", "uDown", "uData"];

function build(canvas: HTMLCanvasElement): Field | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("Watchlist heat map: shader not compiled —", gl.getShaderInfoLog(s));
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
    console.warn("Watchlist heat map: program not linked —", gl.getProgramInfoLog(prog));
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
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.uniform1i(u.uData, 0);
  return { gl, u, tex, data: new Uint8Array(4), count: 0, cols: 0, hover: -1, tiles: [], colors: null, dirty: true, lost: false };
}

/** Packs the tiles into the data texture: heat, flags, corners. */
function upload(f: Field) {
  const n = f.tiles.length;
  if (f.data.length < Math.max(1, n) * 4) f.data = new Uint8Array(Math.max(1, n) * 4);
  f.tiles.forEach((t, i) => {
    f.data[i * 4] = Math.round(128 + Math.max(-1, Math.min(1, t.heat)) * 127);
    f.data[i * 4 + 1] = (t.selected ? 1 : 0) | (i === f.hover ? 2 : 0);
    f.data[i * 4 + 2] = f.cols ? outerCorners(i, n, f.cols) : 0;
    f.data[i * 4 + 3] = 255;
  });
  f.count = n;
  const { gl } = f;
  gl.bindTexture(gl.TEXTURE_2D, f.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, Math.max(1, n), 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data.subarray(0, Math.max(1, n) * 4));
  f.dirty = true;
}

function readColors(el: HTMLElement): NonNullable<Field["colors"]> {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name);
  const ink = parseColor(`rgb(${v("--ink")})`, [1, 1, 1, 1]);
  return {
    ink,
    tile: parseColor(v("--tile"), [ink[0], ink[1], ink[2], 0.04]),
    up: parseColor(v("--up"), [0.19, 0.82, 0.35, 1]),
    down: parseColor(v("--down"), [1, 0.27, 0.23, 1]),
  };
}

/** Frames per second while the tide moves: slow water needs few. */
const FPS = 30;

export function useHeatField(canvas: RefObject<HTMLCanvasElement | null>, grid: RefObject<HTMLElement | null>, tiles: HeatTile[], active: boolean) {
  const field = useRef<Field | null>(null);

  /* The context, once per canvas. */
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
    /* The theme: its tokens change under the same element. */
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

  /* The tiles: re-packed whenever they change. */
  useEffect(() => {
    const f = field.current;
    if (!f || f.lost) return;
    f.tiles = tiles;
    upload(f);
  }, [tiles]);

  /* The loop, only while the tab is in front. */
  useEffect(() => {
    const f = field.current;
    const el = canvas.current;
    const box = grid.current;
    if (!active || !f || !el || !box) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sized = { w: 0, h: 0, dpr: 0 };
    const resize = new ResizeObserver(() => {
      f.dirty = true;
      sized.w = 0;
    });
    resize.observe(box);
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

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = box.getBoundingClientRect();
      if (sized.w !== rect.width || sized.h !== rect.height || sized.dpr !== dpr) {
        el.width = Math.max(1, Math.round(rect.width * dpr));
        el.height = Math.max(1, Math.round(rect.height * dpr));
        Object.assign(sized, { w: rect.width, h: rect.height, dpr });
      }
      const cells = box.querySelectorAll<HTMLElement>("[data-tile]");
      const first = cells[0]?.getBoundingClientRect();
      if (!first || f.count === 0) {
        f.gl.clearColor(0, 0, 0, 0);
        f.gl.clear(f.gl.COLOR_BUFFER_BIT);
        return;
      }
      let cols = 0;
      for (const c of cells) {
        if (Math.abs(c.getBoundingClientRect().top - first.top) > 1) break;
        cols += 1;
      }
      const second = cells[1]?.getBoundingClientRect();
      const gap = second && cols > 1 ? second.left - first.right : second ? second.top - first.bottom : 2;
      if (cols !== f.cols) {
        f.cols = cols;
        upload(f);
      }
      f.colors ??= readColors(box);
      const { gl, u, colors } = f;

      gl.viewport(0, 0, el.width, el.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uSize, rect.width, rect.height);
      gl.uniform1f(u.uDpr, el.width / rect.width);
      gl.uniform1f(u.uTime, moving ? (now - t0) / 1000 : 0);
      gl.uniform2f(u.uOrigin, first.left - rect.left, first.top - rect.top);
      gl.uniform2f(u.uTile, first.width, first.height);
      gl.uniform1f(u.uGap, Math.max(0, gap));
      gl.uniform1f(u.uRadius, parseFloat(getComputedStyle(box).getPropertyValue("--r-block")) || 16);
      gl.uniform1i(u.uCols, Math.max(1, cols));
      gl.uniform1i(u.uCount, f.count);
      gl.uniform3f(u.uInk, colors.ink[0], colors.ink[1], colors.ink[2]);
      gl.uniform1f(u.uTileAlpha, colors.tile[3]);
      gl.uniform3f(u.uUp, colors.up[0], colors.up[1], colors.up[2]);
      gl.uniform3f(u.uDown, colors.down[0], colors.down[1], colors.down[2]);
      gl.bindTexture(gl.TEXTURE_2D, f.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    f.dirty = true;
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [active, canvas, grid]);

  /** The tile under the pointer (-1: none), lit a little. */
  return useCallback((i: number) => {
    const f = field.current;
    if (!f || f.lost || f.hover === i) return;
    f.hover = i;
    upload(f);
  }, []);
}
