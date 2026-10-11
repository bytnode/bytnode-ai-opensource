"use client";

import { useEffect, useRef, type RefObject } from "react";

/* ---------------------------------------------------------------------------
   The floating agent's body: a small COMPANION, drawn on the GPU (WebGL 2,
   one fragment shader). No disc around it — its outline is its own.

   ONE shape, ONE material, a face (user request, 2026-10-05: the machined
   polyhedron with its visor read as a toy robot — "simpler, less
   childish", the same expressions). The shape is a pentagon with generous
   round corners, a point at the top — BytNode's node, made into a pebble.
   The material is the app's: on the night the composer's navy glass, lit
   from above by the backdrop's beams, edged with the titles' silver ink,
   over the beams' glow; on the day the titles' navy ink. A flat bevel lit
   from the upper left and reflections, as on polished glass: the studio's
   window as a curved band across the top, a crisp glint, a rim of light
   all around and the backdrop's blue bouncing into its lower edge — they
   slide against the gaze as it turns. Around it, an AURA that follows its
   outline and breathes (user request: its contours more visible) — the
   backdrop's blue, bright blue while it writes, amber while it calls. The face is
   two plain eyes laid on the surface; nothing else.

   Bigger and brighter (user request, 2026-10-08: « plus grand et plus
   visible… plus lumineux avec de tout petits points blancs qui gravitent
   autour »; then « un tout petit peu trop gros », « encore légèrement »): an 80 px button, the canvas reaching 28 px past it
   (`.fc-canvas`) so the aura and the orbits are never cut; a stronger aura
   and rim; and a few tiny white points circling it on tilted orbits,
   passing behind it, then in front of it — faster while it writes.

   Everything is a 2D distance field, anti-aliased on one device pixel:
   the edge is crisp at any size. It turns without 3D: when it looks
   somewhere, its eyes slide that way and its sheen the other — the eye
   reads an object pivoting.

   It is alive, as before:
   - it breathes and floats over its own shadow;
   - it blinks (every few seconds, sometimes twice);
   - it looks at the pointer, and glances around when nobody moves;
   - under the hand it smiles (its eyes close into arcs); dragged, its eyes
     widen and it stretches with the speed;
   - writing: its eyes turn blue and look down, a light sweeps across it;
   - a permission waits: its eyes turn amber and it hops;
   - a reply to read: a blue dot at its shoulder.

   It sleeps when hidden (the home tab, a hidden page) and holds still under
   `prefers-reduced-motion`. Without WebGL 2 the canvas never goes live and
   the CSS mark stays (`.fc-avatar:has(canvas.is-live)` hides it).

   The desktop app's icon is this companion, drawn once in SVG
   (`desktop/resources/icon.svg`): change its look here, redraw it there.

   ⚠️ ONE CONTEXT PER CANVAS, FOR LIFE: never `loseContext()` on unmount —
   React's dev double-mount would hand the next mount a dead context. The
   program is cached per canvas.
--------------------------------------------------------------------------- */

export type Mood = {
  busy: boolean;
  waiting: boolean;
  unread: boolean;
  hover: boolean;
  dragging: boolean;
};

/** The pentagon's circumradius, in the canvas (-1..1: the 80 px button and
    28 px around it); its resting centre leaves room under it for the
    shadow and the hop. */
const SIZE = 0.42;
const REST_Y = 0.05;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uSize;        // device px
uniform float uTime;
uniform vec2 uCenter;      // canvas units, y up
uniform vec2 uScale;       // breathing, squash and stretch
uniform float uRoll;
uniform vec2 uLook;        // -1..1
uniform float uBlink;      // 0 open .. 1 shut
uniform float uHappy;      // eyes as arcs
uniform float uWide;
uniform float uBusy;
uniform float uWait;
uniform float uSpark;
uniform float uLift;       // 0 on the ground .. 1 at the top of a hop
uniform vec3 uTop;         // the ink, top and bottom
uniform vec3 uBottom;
uniform vec3 uEdge;        // the hairline of light, the reflections
uniform vec4 uAura;        // the glow around it, and its strength
uniform vec3 uBounce;      // the backdrop's blue, caught at the bottom
uniform vec3 uEye;
uniform vec3 uBlue;
uniform vec3 uAmber;
uniform vec4 uShadow;
uniform vec3 uStar;        // the orbiting points, and their glow
uniform vec3 uStarGlow;

out vec4 outColor;

const float R = ${SIZE.toFixed(3)};
const float ROUND = ${(SIZE * 0.15).toFixed(3)};

// A regular pentagon, point up (Inigo Quilez's sdPentagon, flipped).
float sdPentagon(vec2 p, float r) {
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  p.y = -p.y;
  p.x = abs(p.x);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}

// The pebble: the pentagon, its corners rounded. Its apothem is r·0.809.
float shape(vec2 q) {
  return sdPentagon(q, R * 0.809 - ROUND) - ROUND;
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void over(inout vec4 acc, vec3 c, float a) {
  acc.rgb = c * a + acc.rgb * (1.0 - a);
  acc.a = a + acc.a * (1.0 - a);
}

// The points orbiting it: each on a tilted ellipse of its own, at its own
// speed; the half of its course behind the body is drawn before it (and
// dimmer), the other half after.
void stars(inout vec4 acc, vec2 p, float px, bool front) {
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float speed = (0.32 + 0.3 * fract(fi * 0.618)) * (1.0 + 1.2 * uBusy);
    float ph = fi * 2.399 + uTime * speed;
    if ((sin(ph) < 0.0) != front) continue;
    float rad = R * (1.2 + 0.4 * fract(fi * 0.37 + 0.2));
    float tilt = 0.22 + 0.45 * fract(fi * 0.71 + 0.1);
    float rot = fi * 0.83;
    vec2 o = vec2(cos(ph) * rad, sin(ph) * rad * tilt);
    o = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * o;
    float dist = length(p - uCenter - o);
    float sr = R * (0.035 + 0.025 * fract(fi * 0.43)) * (front ? 1.15 : 0.85);
    float a = (0.7 + 0.3 * sin(uTime * (2.1 + fi * 0.37) + fi * 4.0)) * (front ? 1.0 : 0.5);
    over(acc, uStarGlow, exp(-dist / (sr * 2.0)) * 0.7 * a);
    over(acc, uStar, clamp(0.5 - (dist - sr) / px, 0.0, 1.0) * a);
  }
}

void main() {
  vec2 p = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  float px = 2.0 / uSize.x;
  vec4 acc = vec4(0.0);

  // Under it, the backdrop's glow (a shadow on the day), smaller and
  // fainter when it rises.
  vec2 sp = (p - vec2(uCenter.x, ${(REST_Y - 1.55 * SIZE).toFixed(3)})) / vec2(R * (0.8 - 0.25 * uLift), R * 0.13);
  over(acc, uShadow.rgb, (1.0 - smoothstep(0.1, 1.0, length(sp))) * uShadow.a * (1.0 - 0.45 * uLift));

  // Into the body's frame: centred, rolled, unsquashed.
  vec2 q = p - uCenter;
  float cr = cos(uRoll);
  float sr = sin(uRoll);
  q = mat2(cr, -sr, sr, cr) * q / uScale;
  float pxl = px / min(uScale.x, uScale.y);

  float d = shape(q);

  // Its aura: a glow that follows its outline, breathing slowly — the
  // backdrop's blue, bright blue while it writes, amber while it calls.
  vec3 auraCol = mix(mix(uAura.rgb, uBlue, uBusy), uAmber, uWait);
  float out_ = max(d, 0.0);
  float halo = 0.55 * exp(-out_ / (R * 0.09)) + 0.45 * exp(-out_ / (R * 0.26));
  // Faded out, round, before the canvas's edges: never a square cut.
  halo *= 1.0 - smoothstep(0.72, 0.98, length(p - uCenter));
  float pulse = 0.85 + 0.15 * sin(uTime * 1.9) + 0.25 * max(uBusy, uWait) * sin(uTime * 4.0);
  over(acc, auraCol, clamp(halo * uAura.a * pulse * (1.0 + 0.25 * uHappy) * step(0.0, d), 0.0, 1.0));

  stars(acc, p, px, false);

  float body = clamp(0.5 - d / pxl, 0.0, 1.0);
  if (body > 0.0) {
    vec2 uv = q / R;                       // about -1..1 across the body
    // The volume: a soft bevel, lit from the upper left — and the light
    // moves against the gaze, as on an object that turns.
    vec2 g = vec2(shape(q + vec2(0.004, 0.0)) - shape(q - vec2(0.004, 0.0)), shape(q + vec2(0.0, 0.004)) - shape(q - vec2(0.0, 0.004))) / 0.008;
    float rim = 1.0 - smoothstep(0.0, R * 0.16, -d);
    vec3 n = normalize(vec3(g * rim * 0.8, 1.0));
    vec2 key = normalize(vec2(-0.55, 0.8) - uLook * 0.35);
    float lit = dot(n, normalize(vec3(key, 0.9)));

    vec3 c = mix(uBottom, uTop, smoothstep(-0.95, 0.85, uv.y + uLook.y * 0.15));
    c *= 0.95 + 0.2 * lit;
    // Reflections, as on polished glass — they slide against the gaze, as
    // on an object that turns. A soft sheen first, high on the lit side.
    vec2 off = uLook * vec2(0.22, 0.14);
    vec2 sh = uv - (vec2(-0.32, 0.42) - off);
    c += uEdge * 0.14 * exp(-dot(sh, sh) * 4.0);
    // The studio's window, mirrored: a curved band across the top.
    vec2 w = uv + off;
    float arch = w.y - (0.3 + 0.28 * w.x * w.x);
    float window = smoothstep(-0.03, 0.04, arch) * (1.0 - smoothstep(0.12, 0.26, arch)) * smoothstep(0.75, -0.2, w.x);
    c = mix(c, uEdge, window * 0.24);
    // A crisp glint where the key light strikes.
    vec2 gp = uv - (vec2(-0.5, 0.5) - off * 0.5);
    gp = mat2(0.8, 0.6, -0.6, 0.8) * gp;
    float glint = 1.0 - smoothstep(0.0, 0.015 + pxl / R, length(gp / vec2(0.1, 0.045)) * 0.1 - 0.06);
    c = mix(c, vec3(1.0), glint * 0.8);
    // A rim of light all around the edge, brightest at the top…
    float edge = 1.0 - smoothstep(pxl * 0.8, pxl * 3.2, -d);
    c = mix(c, mix(uEdge, auraCol, 0.35), edge * (0.7 + 0.3 * smoothstep(-0.6, 0.6, uv.y - uv.x * 0.4)));
    // …and the backdrop's blue bouncing into its lower edge.
    float bounce = (1.0 - smoothstep(0.0, R * 0.14, -d)) * smoothstep(0.1, -0.7, uv.y);
    c = mix(c, uBounce, bounce * 0.55);

    // Writing: a light sweeps across it, slowly.
    float sweep = fract(uTime * 0.35);
    float band = exp(-pow((dot(uv, normalize(vec2(1.0, 0.6))) - mix(-1.6, 1.6, sweep)) / 0.22, 2.0));
    c = mix(c, uBlue, band * 0.28 * uBusy);

    // The face: two plain eyes, sliding toward the gaze.
    vec3 eyeCol = mix(mix(uEye, uBlue, uBusy), uAmber, uWait);
    float eyes = 0.0;
    for (int k = 0; k < 2; k++) {
      float side = k == 0 ? -1.0 : 1.0;
      vec2 ec = vec2(side * 0.27, -0.02) + uLook * vec2(0.16, 0.12);
      vec2 e = uv - ec;
      float hw = 0.085 * (1.0 + 0.15 * uWide);
      float hh = 0.15 * (1.0 + 0.15 * uWide) * (1.0 - 0.35 * uBusy);
      hh = max(hh * (1.0 - uBlink), 0.026);
      float cap = sdRoundBox(e, vec2(hw, hh), min(hw, hh));
      vec2 a = e + vec2(0.0, 0.05);
      float rr = 0.11;
      float arc = a.y > 0.0 ? abs(length(a) - rr) - 0.034 : length(vec2(abs(a.x) - rr, a.y)) - 0.034;
      float de = mix(cap, arc, uHappy);
      eyes = max(eyes, clamp(0.5 - de * R / pxl, 0.0, 1.0));
    }
    c = mix(c, eyeCol, eyes);
    over(acc, c, body);
  }

  stars(acc, p, px, true);

  // A reply to read: a blue dot at its shoulder, cut out of the body.
  vec2 dp = (p - uCenter) - R * vec2(0.62, 0.55);
  float dot_ = length(dp) - R * 0.13 * uSpark;
  float ring = length(dp) - R * 0.13 * uSpark - pxl * 2.0;
  float cut = clamp(0.5 - ring / px, 0.0, 1.0) * step(0.02, uSpark);
  acc *= 1.0 - cut;
  over(acc, uBlue, clamp(0.5 - dot_ / px, 0.0, 1.0) * step(0.02, uSpark));

  outColor = acc;
}`;

const UNIFORMS = ["uSize", "uTime", "uCenter", "uScale", "uRoll", "uLook", "uBlink", "uHappy", "uWide", "uBusy", "uWait", "uSpark", "uLift", "uTop", "uBottom", "uEdge", "uAura", "uBounce", "uEye", "uBlue", "uAmber", "uShadow", "uStar", "uStarGlow"] as const;

type Field = { gl: WebGL2RenderingContext; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };

const fields = new WeakMap<HTMLCanvasElement, Field | null>();

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("companion:", gl.getShaderInfoLog(sh));
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
        const u = {} as Field["u"];
        for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
        field = { gl, u };
      } else console.warn("companion:", gl.getProgramInfoLog(prog));
    }
  }
  fields.set(canvas, field);
  return field;
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** The app's own colours, theme by theme (it follows the switch live).
    On the night: the composer's navy glass — the backdrop's beams
    (`MARINE.scene.lumiere`, 30 56 118, raised) lighting it from above —, a
    hairline of the titles' silver ink, silver eyes, the beams' glow under
    it. On the day: the day's pearl glass — white to a blue-grey —, navy
    eyes in the titles' day ink, a blue rim and a stronger blue aura that
    draw its outline on the pale page (user request: it must read better
    on the day). The orbiting points are white, glowing blue — on the day a
    deeper blue, or white would vanish on the page. */
function palette() {
  return document.documentElement.dataset.theme === "light"
    ? { top: hex("#fbfcfe"), bottom: hex("#c2cfe4"), edge: hex("#5f84c8"), bounce: hex("#8eaee6"), aura: [0.2, 0.4, 0.88, 0.75], eye: hex("#1c2b45"), blue: hex("#007aff"), amber: hex("#e8890b"), shadow: [0.12, 0.18, 0.3, 0.32], star: hex("#ffffff"), starGlow: hex("#3f78e0") }
    : { top: hex("#2a4782"), bottom: hex("#0c1628"), edge: hex("#e2e8f2"), bounce: hex("#4275d8"), aura: [0.36, 0.58, 1.0, 0.72], eye: hex("#f0f4fa"), blue: hex("#0a84ff"), amber: hex("#ff9f0a"), shadow: [0.22, 0.38, 0.74, 0.5], star: hex("#ffffff"), starGlow: hex("#9cc3ff") };
}

const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * Math.min(1, dt * rate);

/** Brings the companion to life in `canvas` while `active`. */
export function useCompanion(canvas: RefObject<HTMLCanvasElement | null>, mood: Mood, active: boolean) {
  const moodRef = useRef(mood);
  useEffect(() => {
    moodRef.current = mood;
  });

  useEffect(() => {
    const el = canvas.current;
    if (!el || !active) return;
    const field = fieldOf(el);
    if (!field) return;
    const { gl, u } = field;
    el.classList.add("is-live");

    let colors = palette();
    const theme = new MutationObserver(() => (colors = palette()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const still = matchMedia("(prefers-reduced-motion: reduce)");

    /* Where the pointer is, and since when it has not moved. */
    const pointer = { x: 0, y: 0, at: -1e9, known: false };
    const onPointer = (e: globalThis.PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.at = performance.now();
      pointer.known = true;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const s = {
      time: 0,
      look: [0, 0] as [number, number],
      glance: [0, 0] as [number, number],
      nextGlance: 0,
      blinkAt: 2,
      blinkT: -1,
      doubleBlink: false,
      happy: 0,
      wide: 0,
      busy: moodRef.current.busy ? 1 : 0,
      wait: moodRef.current.waiting ? 1 : 0,
      spark: moodRef.current.unread ? 1 : 0,
      stretch: [0, 0] as [number, number],
      lastBox: null as DOMRect | null,
    };
    let last = 0;
    let raf = 0;

    const step = (dt: number, now: number, moving: boolean) => {
      const m = moodRef.current;
      s.time += dt;
      s.busy = ease(s.busy, m.busy ? 1 : 0, 3, dt);
      s.wait = ease(s.wait, m.waiting ? 1 : 0, 4, dt);
      s.spark = ease(s.spark, m.unread ? 1 : 0, 6, dt);
      s.happy = ease(s.happy, m.hover && !m.dragging && !m.waiting ? 1 : 0, 9, dt);
      s.wide = ease(s.wide, m.dragging || m.waiting ? 1 : 0, 8, dt);
      if (!moving) return;

      /* The gaze: the pointer, or — nobody moving for a while — a glance
         somewhere, now and then. */
      const box = el.getBoundingClientRect();
      let target: [number, number];
      if (pointer.known && now - pointer.at < 4000) {
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        const len = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, len / 180);
        target = [(dx / len) * k, (-dy / len) * k];
      } else {
        if (s.time > s.nextGlance) {
          s.glance = Math.random() < 0.35 ? [0, 0] : [Math.random() * 1.6 - 0.8, Math.random() * 1.0 - 0.5];
          s.nextGlance = s.time + 1.8 + Math.random() * 2.6;
        }
        target = s.glance;
      }
      if (m.busy) target = [target[0] * 0.4, target[1] * 0.4 - 0.5];
      s.look = [ease(s.look[0], target[0], 7, dt), ease(s.look[1], target[1], 7, dt)];

      /* Blinking: every 2.5–6 s, sometimes twice. */
      if (s.blinkT < 0 && s.time > s.blinkAt) s.blinkT = 0;
      if (s.blinkT >= 0) {
        s.blinkT += dt;
        if (s.blinkT > 0.16) {
          s.blinkT = -1;
          if (!s.doubleBlink && Math.random() < 0.22) {
            s.doubleBlink = true;
            s.blinkAt = s.time + 0.12;
          } else {
            s.doubleBlink = false;
            s.blinkAt = s.time + 2.5 + Math.random() * 3.5;
          }
        }
      }

      /* Dragged: it stretches with the speed. */
      if (s.lastBox && dt > 0) {
        const vx = (box.left - s.lastBox.left) / dt;
        const vy = (box.top - s.lastBox.top) / dt;
        s.stretch = [ease(s.stretch[0], Math.max(-1, Math.min(1, vx / 1400)), 12, dt), ease(s.stretch[1], Math.max(-1, Math.min(1, vy / 1400)), 12, dt)];
      }
      s.lastBox = box;
    };

    const draw = (moving: boolean) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      gl.viewport(0, 0, w, h);

      const t = s.time;
      /* Breathing, floating, hopping when it calls. */
      const breath = moving ? Math.sin(t * 1.9) : 0;
      let lift = moving ? 0.5 + 0.5 * Math.sin(t * 1.15) : 0.5;
      let sx = 1 + 0.02 * breath;
      let sy = 1 - 0.014 * breath;
      let cy = REST_Y + (moving ? 0.028 * Math.sin(t * 1.15) : 0);
      if (moving && s.wait > 0.05) {
        const ph = (t % 1.6) / 1.6;
        const hop = ph < 0.34 ? Math.sin((ph / 0.34) * Math.PI) : 0;
        const land = ph >= 0.34 && ph < 0.46 ? Math.sin(((ph - 0.34) / 0.12) * Math.PI) : 0;
        cy += 0.125 * hop * s.wait;
        lift = Math.max(lift * (1 - s.wait), hop);
        sx *= 1 + 0.08 * land * s.wait;
        sy *= 1 - 0.1 * land * s.wait;
      }
      const grow = 1 + 0.05 * s.happy;
      /* Turned toward a side, it narrows a little, as a body seen at an
         angle does. */
      sx *= grow * (1 - 0.05 * Math.abs(s.look[0])) * (1 + Math.abs(s.stretch[0]) * 0.18 - Math.abs(s.stretch[1]) * 0.08);
      sy *= grow * (1 + Math.abs(s.stretch[1]) * 0.18 - Math.abs(s.stretch[0]) * 0.08);
      const cx = -s.stretch[0] * 0.06 + s.look[0] * 0.025;
      const roll = (moving ? Math.sin(t * 0.9) * 0.035 : 0) - s.look[0] * 0.06 - s.stretch[0] * 0.2;

      const blink = s.blinkT >= 0 ? Math.sin((s.blinkT / 0.16) * Math.PI) : 0;
      gl.uniform2f(u.uSize, w, h);
      gl.uniform1f(u.uTime, t);
      gl.uniform2f(u.uCenter, cx, cy);
      gl.uniform2f(u.uScale, sx, sy);
      gl.uniform1f(u.uRoll, roll);
      gl.uniform2f(u.uLook, s.look[0], s.look[1]);
      gl.uniform1f(u.uBlink, moving ? blink : 0);
      gl.uniform1f(u.uHappy, s.happy);
      gl.uniform1f(u.uWide, s.wide);
      gl.uniform1f(u.uBusy, s.busy);
      gl.uniform1f(u.uWait, s.wait);
      gl.uniform1f(u.uSpark, s.spark);
      gl.uniform1f(u.uLift, lift);
      gl.uniform3fv(u.uTop, colors.top);
      gl.uniform3fv(u.uBottom, colors.bottom);
      gl.uniform3fv(u.uEdge, colors.edge);
      gl.uniform3fv(u.uBounce, colors.bounce);
      gl.uniform4fv(u.uAura, colors.aura);
      gl.uniform3fv(u.uEye, colors.eye);
      gl.uniform3fv(u.uBlue, colors.blue);
      gl.uniform3fv(u.uAmber, colors.amber);
      gl.uniform4fv(u.uShadow, colors.shadow);
      gl.uniform3fv(u.uStar, colors.star);
      gl.uniform3fv(u.uStarGlow, colors.starGlow);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      step(dt, now, true);
      draw(true);
    };

    /* Held still: the mood is shown, nothing moves; redrawn a few times a
       second so a change of mood still shows. */
    let calm = 0;
    const start = () => {
      cancelAnimationFrame(raf);
      window.clearInterval(calm);
      last = 0;
      if (document.hidden) return;
      if (still.matches) {
        const once = () => {
          step(1, performance.now(), false);
          draw(false);
        };
        once();
        calm = window.setInterval(once, 400);
      } else raf = requestAnimationFrame(frame);
    };
    start();
    still.addEventListener("change", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(calm);
      theme.disconnect();
      window.removeEventListener("pointermove", onPointer);
      still.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [canvas, active]);
}
