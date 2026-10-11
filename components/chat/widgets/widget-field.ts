"use client";

import { useEffect, useRef, type RefObject } from "react";

/* ---------------------------------------------------------------------------
   The widgets' light, drawn on the GPU (WebGL 2, one fragment shader).

   ONE canvas lies under all the floating widgets (never one per widget:
   a page holds few WebGL contexts, and the composer, the companion and the
   plugins' tabs already have theirs). For each widget it paints, inside
   the widget's rounded box only, a soft light that drifts slowly — tinted
   by what the widget says: green when it rises, red when it falls, the
   app's blue or a calendar's violet otherwise — and a hairline at its top
   edge. The cards above are frosted glass (`widgets.css`): their backdrop
   blur diffuses that light, as the coloured grounds of Apple's widgets.

   Geometry is measured, not assumed: each card's box relative to the
   canvas (`[data-widget]`), re-read when anything resizes. It sleeps when
   the page is hidden or the column is, and holds still under
   `prefers-reduced-motion`. Without WebGL 2 the canvas never goes live and
   the cards keep their plain CSS ground.

   ⚠️ ONE CONTEXT PER CANVAS, FOR LIFE: never `loseContext()` on unmount —
   React's dev double-mount would hand the next mount a dead one. Cached
   per canvas.
--------------------------------------------------------------------------- */

export const MAX_WIDGETS = 16;

/** A widget's light: a colour and how strongly it shows (0..1). */
export type Tone = { rgb: [number, number, number]; strength: number };

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uSize;                   // canvas, CSS px
uniform float uDpr;
uniform float uTime;
uniform float uRadius;
uniform int uCount;
uniform vec4 uRects[${MAX_WIDGETS}];  // x, y, w, h (CSS px, y down)
uniform vec4 uTones[${MAX_WIDGETS}];  // rgb, strength
uniform float uLight;                 // 1 on the day theme

out vec4 outColor;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec2 css = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MAX_WIDGETS}; i++) {
    if (i >= uCount) break;
    vec4 r = uRects[i];
    vec2 c = r.xy + r.zw * 0.5;
    float d = sdBox(css - c, r.zw * 0.5, uRadius);
    if (d > 1.0) continue;
    float inside = clamp(0.5 - d, 0.0, 1.0);
    vec2 uv = (css - r.xy) / r.zw;              // 0..1 across the card
    float seed = float(i) * 7.31;
    // Two lights drifting slowly in the card's upper part.
    vec2 a = vec2(0.22 + 0.16 * sin(uTime * 0.21 + seed), 0.18 + 0.1 * cos(uTime * 0.17 + seed));
    vec2 b = vec2(0.78 + 0.14 * cos(uTime * 0.15 + seed * 1.7), 0.4 + 0.18 * sin(uTime * 0.19 + seed));
    vec2 aspect = vec2(r.z / max(r.w, 1.0), 1.0);
    float la = exp(-dot((uv - a) * aspect, (uv - a) * aspect) * 3.2);
    float lb = exp(-dot((uv - b) * aspect, (uv - b) * aspect) * 4.5) * 0.6;
    float glow = (la + lb) * uTones[i].a * mix(0.55, 0.42, uLight);
    // A hairline of light along the top edge.
    float rim = (1.0 - smoothstep(0.0, 1.6, abs(d + 0.8))) * smoothstep(0.55, 0.0, uv.y) * mix(0.16, 0.1, uLight);
    vec3 col = uTones[i].rgb * glow + vec3(1.0) * rim;
    float alpha = clamp(glow * 0.9 + rim, 0.0, 1.0) * inside;
    // Premultiplied.
    acc += vec4(col * inside, alpha) * (1.0 - acc.a);
  }
  outColor = acc;
}`;

type Field = { gl: WebGL2RenderingContext; u: Record<string, WebGLUniformLocation | null> };
const fields = new WeakMap<HTMLCanvasElement, Field | null>();

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("widget field:", gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

function fieldOf(canvas: HTMLCanvasElement): Field | null {
  if (fields.has(canvas)) return fields.get(canvas) ?? null;
  let field: Field | null = null;
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
  if (gl) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = vs && fs ? gl.createProgram() : null;
    if (prog && vs && fs) {
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "aPos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const u: Field["u"] = {};
        for (const name of ["uSize", "uDpr", "uTime", "uRadius", "uCount", "uRects", "uTones", "uLight"]) u[name] = gl.getUniformLocation(prog, name);
        field = { gl, u };
      } else console.warn("widget field:", gl.getProgramInfoLog(prog));
    }
  }
  fields.set(canvas, field);
  return field;
}

/** Lights the widgets laid in `grid` (each `[data-widget]` child), with
    `tones` by widget id, while `active`. */
export function useWidgetField(canvas: RefObject<HTMLCanvasElement | null>, grid: RefObject<HTMLElement | null>, tones: Record<string, Tone>, active: boolean) {
  const tonesRef = useRef(tones);
  useEffect(() => {
    tonesRef.current = tones;
  });

  useEffect(() => {
    const el = canvas.current;
    const root = grid.current;
    if (!el || !root || !active) return;
    const field = fieldOf(el);
    if (!field) return;
    const { gl, u } = field;
    el.classList.add("is-live");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const rects = new Float32Array(MAX_WIDGETS * 4);
    const tns = new Float32Array(MAX_WIDGETS * 4);
    let count = 0;
    let ids: string[] = [];
    let radius = 22;

    /* Each card's box, relative to the canvas. */
    const measure = () => {
      const base = el.getBoundingClientRect();
      const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-widget]")).slice(0, MAX_WIDGETS);
      ids = cards.map((c) => c.dataset.widget ?? "");
      count = cards.length;
      cards.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        rects.set([r.left - base.left, r.top - base.top, r.width, r.height], i * 4);
      });
      if (cards[0]) radius = parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius) || radius;
    };

    let time = 0;
    let last = 0;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      gl.viewport(0, 0, w, h);
      ids.forEach((id, i) => {
        const t = tonesRef.current[id];
        tns.set(t ? [t.rgb[0], t.rgb[1], t.rgb[2], t.strength] : [0.24, 0.42, 0.85, 0.5], i * 4);
      });
      gl.uniform2f(u.uSize, el.clientWidth, el.clientHeight);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uRadius, radius);
      gl.uniform1i(u.uCount, count);
      gl.uniform4fv(u.uRects, rects);
      gl.uniform4fv(u.uTones, tns);
      gl.uniform1f(u.uLight, document.documentElement.dataset.theme === "light" ? 1 : 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    /* ~30 frames a second: a slow drift needs no more. */
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;
      time += last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      /* Measured each frame: a card let go glides to its place by a CSS
         transition, which changes no attribute the observer sees. */
      measure();
      draw();
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (document.hidden) return;
      if (still.matches) draw();
      else raf = requestAnimationFrame(frame);
    };

    measure();
    const ro = new ResizeObserver(() => {
      measure();
      if (still.matches) draw();
    });
    ro.observe(root);
    for (const c of Array.from(root.children)) ro.observe(c);
    const mo = new MutationObserver(() => {
      for (const c of Array.from(root.children)) ro.observe(c);
      measure();
      if (still.matches) draw();
    });
    /* A card added, removed, resized or carried (its style's left/top). */
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-size", "data-widget", "style"] });
    const scroller = root.closest(".wg-scroll");
    const onScroll = () => measure();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    start();
    still.addEventListener("change", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      /* Asleep or hidden: no light left behind — the canvas keeps its last
         frame otherwise, and the hidden widgets still showed, faintly (user
         report). */
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      el.classList.remove("is-live");
      ro.disconnect();
      mo.disconnect();
      scroller?.removeEventListener("scroll", onScroll);
      still.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [canvas, grid, active]);
}
