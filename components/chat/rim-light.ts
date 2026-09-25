"use client";

import { useEffect, useRef, type RefObject } from "react";

/* ---------------------------------------------------------------------------
   The composer's rim of light, drawn on the GPU (WebGL 2, one fragment
   shader): the edge of a sheet of glass catching the backdrop's light.

   The composer is a rounded rectangle of frosted glass (CSS). This canvas
   lies under its content, a little larger than it, and adds only light: a
   hairline along the edge, in the backdrop's navy (`MARINE.scene.lumiere`,
   raised to read on black), where two soft glints travel — one steel blue,
   one smaller with a touch of the palette's sand —, a faint bloom just
   outside the edge under the glints, and inside, a sheen falling from the
   top edge as on a glass pane.

   It answers what happens, and nothing else moves it:
     idle    the rim at rest, drawn once — no loop;
     focus   the user writes: brighter, the glints drift slowly;
     busy    the agent replies: brighter still, the glints travel faster.
   The level eases between states (~0.4 s) and the loop stops once idle is
   reached. `prefers-reduced-motion`: the level changes, the glints stay put.

   Without WebGL 2 the canvas never goes live and the glass keeps its CSS
   hairline. ⚠️ One context per canvas for life: never lost on purpose
   (see the watchlist's heat field — React's double mount in development
   would hand the next mount a dead one); the program is cached per canvas.
--------------------------------------------------------------------------- */

export type RimState = "idle" | "focus" | "busy";

/** How far the canvas overflows the composer on each side, in CSS px: room
    for the bloom. `composer.css` (`.cmp-rim`) uses the same value. */
export const RIM_BLEED = 14;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uSize;     // the canvas, CSS px
uniform float uDpr;
uniform float uBleed;   // CSS px between the canvas edge and the glass
uniform float uRadius;  // the glass's corner radius, CSS px
uniform float uTime;    // s
uniform float uLevel;   // 0 idle .. 1 busy
uniform float uLight;   // 1 on a dark theme, 0 on a light one

out vec4 outColor;

// Signed distance to a rounded rectangle centred at the origin.
float roundedBox(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// A glint around the perimeter: 1 at angle c, falling off with sharpness k.
float glint(float a, float c, float k) {
  return pow(0.5 + 0.5 * cos(a - c), k);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 centre = uSize * 0.5;
  vec2 p = px - centre;
  vec2 hs = centre - uBleed;
  float d = roundedBox(p, hs, uRadius);

  // The angle around the glass, on a squashed circle so a wide pane is
  // walked at an even pace.
  float a = atan(p.y / max(hs.y, 1.0), p.x / max(hs.x, 1.0));
  float t = uTime;
  float g1 = glint(a, t * 0.42 - 2.2, 7.0);
  float g2 = glint(a, -t * 0.27 + 0.9, 16.0);
  float lit = 0.22 + 0.78 * clamp(g1 + 0.8 * g2, 0.0, 1.0);

  // The hues: the backdrop's navy, a steel blue for the glints, the sand.
  vec3 navy = vec3(0.19, 0.33, 0.66);
  vec3 steel = vec3(0.47, 0.62, 0.9);
  vec3 sand = vec3(0.86, 0.81, 0.7);
  vec3 hue = mix(navy, steel, clamp(g1 + g2, 0.0, 1.0));
  hue = mix(hue, sand, 0.45 * g2);

  float level = mix(0.38, 1.0, uLevel);
  float px1 = 1.0 / uDpr;

  // The hairline on the edge, one device pixel and its antialiasing.
  float line = 1.0 - smoothstep(0.0, 0.9 + px1, abs(d + 0.5));
  // The bloom outside the edge, under the glints only.
  float bloom = d > 0.0 ? exp(-d / 7.0) * 0.32 * (g1 + 0.7 * g2) : 0.0;
  // Inside: a sheen falling from the top edge, a pane catching the light.
  float inside = d < 0.0 ? 1.0 : 0.0;
  float top = clamp((px.y - uBleed) / max(hs.y * 2.0, 1.0), 0.0, 1.0);
  float sheen = inside * exp(-(-d) / 16.0) * (0.10 + 0.14 * g1) + inside * (1.0 - smoothstep(0.0, 0.5, top)) * 0.035;

  float alpha = (line * lit * 0.9 + bloom + sheen) * level;
  // A light theme: the same light, quieter, the glints darker than the page.
  alpha *= mix(0.55, 1.0, uLight);
  alpha = clamp(alpha, 0.0, 1.0);
  outColor = vec4(hue * alpha, alpha);
}`;

type Rim = {
  gl: WebGL2RenderingContext;
  u: Record<string, WebGLUniformLocation | null>;
  lost: boolean;
};

const RIMS = new WeakMap<HTMLCanvasElement, Rim>();
const UNIFORMS = ["uSize", "uDpr", "uBleed", "uRadius", "uTime", "uLevel", "uLight"];

function build(canvas: HTMLCanvasElement): Rim | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("Composer rim: shader not compiled —", gl.getShaderInfoLog(s));
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
    console.warn("Composer rim: program not linked —", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
  return { gl, u, lost: false };
}

const TARGET: Record<RimState, number> = { idle: 0, focus: 0.62, busy: 1 };
/** How fast the glints travel, per state. */
const PACE: Record<RimState, number> = { idle: 0, focus: 0.55, busy: 1.6 };

/** Draws the rim on `canvas` (which overflows its glass by `RIM_BLEED`);
    `radius` is the glass's corner radius in CSS px. */
export function useRimLight(canvas: RefObject<HTMLCanvasElement | null>, state: RimState, radius: number) {
  const target = useRef(state);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    target.current = state;
    wake.current?.();
  }, [state]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const rim = RIMS.get(el) ?? build(el);
    if (!rim || rim.lost) return;
    RIMS.set(el, rim);
    el.classList.add("is-live");
    const still = matchMedia("(prefers-reduced-motion: reduce)");

    let level = TARGET[target.current];
    /* The glints' clock only runs while something moves them. */
    let clock = 8;
    let last = performance.now();
    let frame = 0;

    const draw = () => {
      const { gl, u } = rim;
      const rect = el.getBoundingClientRect();
      /* On screen, zoom included: the bitmap matches the pixels. */
      const scale = el.offsetWidth ? rect.width / el.offsetWidth : 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uSize, rect.width, rect.height);
      gl.uniform1f(u.uDpr, w / Math.max(1, rect.width));
      gl.uniform1f(u.uBleed, RIM_BLEED * scale);
      gl.uniform1f(u.uRadius, radius * scale);
      gl.uniform1f(u.uTime, clock);
      gl.uniform1f(u.uLevel, level);
      gl.uniform1f(u.uLight, document.documentElement.dataset.theme === "light" ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const tick = (now: number) => {
      frame = 0;
      if (rim.lost) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const goal = TARGET[target.current];
      level += (goal - level) * Math.min(1, dt * 7);
      if (Math.abs(goal - level) < 0.004) level = goal;
      const pace = still.matches ? 0 : PACE[target.current];
      clock += dt * pace;
      draw();
      /* Keep going while the level eases or the glints travel. */
      if (level !== goal || pace > 0) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    wake.current = start;

    const lost = (e: Event) => {
      e.preventDefault();
      rim.lost = true;
      el.classList.remove("is-live");
    };
    el.addEventListener("webglcontextlost", lost);
    const resize = new ResizeObserver(() => start());
    resize.observe(el);
    const theme = new MutationObserver(() => start());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    start();

    return () => {
      cancelAnimationFrame(frame);
      frame = 0;
      wake.current = null;
      resize.disconnect();
      theme.disconnect();
      el.removeEventListener("webglcontextlost", lost);
      el.classList.remove("is-live");
    };
  }, [canvas, radius]);
}
