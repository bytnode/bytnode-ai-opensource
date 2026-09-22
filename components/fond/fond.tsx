"use client";

import { useEffect, useRef } from "react";
import { MARINE, mel, rgb, saturer } from "./palette";
import "./fond.css";

/* ---------------------------------------------------------------------------
   THE BACKDROP OF THE WHOLE APPLICATION  ·  a raking light in navy blue

   ⚠️ IT IS A LIGHT, NOT A GRADIENT. Round layers laid here and there make a
   sky; oblique BEAMS make a SCENE. Four of them descend from the top of the
   page towards the bottom right, separated by dark corridors, and the light
   dies before it has crossed the screen. The difference reads at once: a
   layer has no origin, a beam comes from somewhere.

   And it comes from the SAME place as the light on the knot, on the home
   page: at the top, a little to the left. The backdrop and the object are lit
   by the same source; without that the eye senses the contradiction without
   being able to name it.

   ⚠️ EACH BEAM IS AN ELLIPSE, NOT A GRADIENT RECTANGLE. A rectangle needs two
   gradients — one across for the soft edges, one lengthwise for the fade-out
   — and two gradients do not multiply in a single fill. A very elongated
   ellipse, obtained by distorting the frame before painting a radial
   gradient, gives both at once and in a single pass: edges blended in both
   directions, no seam.

   ⚠️ FOUR NARROW RAYS, SEPARATED BY BLACK. An earlier version had only three,
   but wide, and they overlapped: the whole read as ONE SINGLE big beam, that
   is, as a blue gradient. A beam only exists through the black that borders
   it — the gap is what designates it, not its brightness. None is parallel to
   another and none has the same width: four twin rays would make a stripe,
   four distinct rays make a source that breaks apart.

   ⚠️ THE DARKEST PART OF THE PAGE IS NOT BLACK, IT IS A BLUE. Fade-out and
   vignette were first painted in `rgba(0,0,0,…)`: wherever the rays did not
   reach, the page tended towards pure black and the shadow became a HOLE.
   Painted with a very low midnight blue, they tend towards a colour — the
   shadow stays in the same family as the light.

   ⚠️ AND THE BLUE IS **DARKENED**, NOT TRANSPARENT. Laying the navy at low
   opacity lets the page's black come through: the blend drifts towards
   grey-blue and the page looks washed out. Here the hue is first pulled down
   towards black, then laid at high opacity. Same final lightness, much higher
   saturation — the colour has to be in the pigment, not in the transparency.

   ⚠️ NOTHING IS ANIMATED AND NOTHING IS INTERACTIVE HERE. It is a backdrop in
   the literal sense: painted once per resize and once per theme change, it
   installs no loop. That is what allows it to sit on EVERY page, including
   the console, without costing anything per frame.
--------------------------------------------------------------------------- */

/** Where the knot sits on the home page, in screen fractions. ⚠️ THESE TWO
    VALUES MUST FOLLOW THOSE OF `sculpture.tsx`: the backdrop uses them so as
    not to lay its glow anywhere other than where the object receives it. */
const OBJ = { x: 0.69, y: 0.495 };

/** The tilt of the rays, measured from the horizontal.

    ⚠️ IT ALSO DECIDES THEIR SPACING. Two origins `dx` apart on the top edge
    are only separated, perpendicular to their axis, by `dx · sin(angle)`: at
    37° a gap of 245 px only gives 147, at 45° it gives 173. Straightening the
    rays therefore moves them away from each other — that is what lets them
    be both thick and distinct. */
const DESC = (45 * Math.PI) / 180;

/** A ray: origin in screen fractions, tilt, half-length and half-width in
    diagonal fractions, opacity of the core. */
const RAYONS: Array<[number, number, number, number, number, number]> = [
  [0.04, -0.1, 1, 0.52, 0.109, 0.36],
  /* The brightest and thinnest: it is the one read as THE ray, the three
     others only surround it. It stays navy and does not whiten — painted with
     the hue of the whites it made a GREY streak across the page. A brighter
     beam has to be so through its intensity, not by losing its colour. */
  [0.21, -0.12, 0.93, 0.48, 0.06, 0.62],
  /* The wide and muted one: it gives thickness without ever reaching the
     brightness of the first two. */
  [0.39, -0.14, 1.06, 0.46, 0.137, 0.24],
  /* The last, a thread, laid much further right: it keeps the right half
     from closing all at once. */
  [0.53, -0.1, 0.88, 0.4, 0.04, 0.4],
];

/** The pitch of the dot grid, in pixels. */
const PAS = 22;

export default function FondMarine() {
  const toile = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = toile.current;
    const hote = canvas?.parentElement;
    if (!canvas || !hote) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pal = MARINE;

    /* The working hues, all drawn from the four roles. */
    const nuit = mel([0, 0, 0], pal.loin, 0.3);
    const marine = mel(pal.loin, pal.atmoA, 0.7);
    const lueur = mel(pal.atmoA, pal.pres, 0.55);
    /* The hue of the rays: the blue of the air, raised in chroma. At 1.55
       the red/blue ratio drops to 0.30 — a frank navy; beyond that it turns
       royal blue, below it stays grey. */
    const rayon = saturer(mel(pal.atmoA, pal.pres, 0.58), 1.55);
    /* The pigment of the ground and that of the shadow, both pulled down
       towards black. */
    const profond = mel([0, 0, 0], pal.atmoA, 0.16);
    const abysse = mel([0, 0, 0], nuit, 0.42);
    /* ⚠️ THE LIGHT VARIANT IS NOT AN INVERSION. Rendering the dark backdrop
       as a negative would give BLACK rays on white, that is, shadows. What is
       preserved from one theme to the other is not the value, it is the
       ROLE: the ground stays what everything rests on, the rays stay what
       crosses it. In light mode, the ground becomes a very pale blue and the
       rays veils barely more SATURATED than it — a light seen through tinted
       glass rather than a lamp in the dark. The direction, though, does not
       change: same tilt, same gaps, same diagonal fade-out. */
    const pale = mel([255, 255, 255], pal.atmoA, 0.07);

    const dessiner = () => {
      const l = hote.clientWidth;
      const h = hote.clientHeight;
      if (l < 2 || h < 2) return;
      const clair = document.documentElement.dataset.theme === "light";
      ctx.clearRect(0, 0, l, h);

      const etroit = l < 980;
      const ox = l * (etroit ? 0.5 : OBJ.x);
      /* 0.72 when narrow: the same value as `sculpture.tsx`. The two must
         move together, otherwise the backdrop's glow lands somewhere other
         than the object that receives it. */
      const oy = h * (etroit ? 0.72 : OBJ.y);
      const diag = Math.hypot(l, h);

      /* A layer: a radial gradient whose opacity falls off gently. The
         intermediate stops are not decorative — a two-stop gradient decays
         linearly and leaves a visible circle halfway. */
      const nappe = (
        x: number,
        y: number,
        r: number,
        c: readonly [number, number, number],
        a: number,
      ) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgb(c, a));
        g.addColorStop(0.35, rgb(c, a * 0.62));
        g.addColorStop(0.68, rgb(c, a * 0.22));
        g.addColorStop(1, rgb(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, l, h);
      };

      /* A ray. ⚠️ THE PROFILE HAS A PLATEAU, AND THAT IS WHAT MAKES THE BEAM.
         A steady decay from the centre gives a blurry BLOB: nowhere is the
         light frank, everywhere it fades. A real ray has a core of roughly
         constant intensity, then an edge that falls off quickly — hence
         these five stops. */
      const faisceau = (
        x: number,
        y: number,
        ang: number,
        L: number,
        W: number,
        c: readonly [number, number, number],
        a: number,
      ) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.scale(L, W);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgb(c, a));
        g.addColorStop(0.18, rgb(c, a * 0.92));
        g.addColorStop(0.45, rgb(c, a * 0.44));
        g.addColorStop(0.72, rgb(c, a * 0.12));
        g.addColorStop(1, rgb(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      };

      /* 1. THE GROUND. It is what decides the colour of the areas the rays
            do not reach. In dark mode: a deep navy, never black. In light
            mode: a very pale blue, laid OPAQUE — it replaces the theme's
            paper, otherwise the rays would float on pure white and the page
            would have no ground at all. */
      if (clair) {
        ctx.fillStyle = rgb(pale, 1);
        ctx.fillRect(0, 0, l, h);
      } else {
        const sol = ctx.createLinearGradient(0, h, 0, 0);
        sol.addColorStop(0, rgb(profond, 0.7));
        sol.addColorStop(0.6, rgb(profond, 0.58));
        sol.addColorStop(1, rgb(nuit, 0.22));
        ctx.fillStyle = sol;
        ctx.fillRect(0, 0, l, h);
      }

      /* 2. THE RAYS. Same positions, same widths, same ratios from one theme
            to the other: only their opacity changes. On a pale ground, a veil
            at 0.30 of the dark opacity is enough — the useful contrast is much
            lower when the backdrop is light. */
      const k = clair ? 0.34 : 1;
      for (const [x, y, incl, L, W, a] of RAYONS) {
        faisceau(l * x, h * y, DESC * incl, diag * L, diag * W, rayon, a * k);
      }
      /* The source itself, off frame: the point everything starts from. */
      nappe(l * 0.17, h * -0.16, diag * 0.28, rayon, 0.12 * k);
      /* The breath of the right edge. Its centre is OFF FRAME: only its tail
         is visible, so no circle can be guessed, and this edge — which the
         four rays do not reach — no longer closes all at once. */
      nappe(l * 1.06, h * 0.3, diag * 0.5, marine, 0.13 * k);
      /* And on the home page, the glow just above the knot: the backdrop and
         the object share their source, that is what holds them together. */
      nappe(ox - l * 0.05, oy - h * 0.4, diag * 0.34, rayon, 0.07 * k);

      /* 3. THE DOT GRID. Made ONCE in a 22 px tile then repeated: drawing the
            two thousand five hundred dots by hand would cost as many calls on
            every resize, the pattern costs only one. It crosses the rays as
            well as the shadow — that is what gives the whole its surface,
            like paper. */
      const tuile = document.createElement("canvas");
      tuile.width = PAS;
      tuile.height = PAS;
      const tc = tuile.getContext("2d");
      if (tc) {
        tc.fillStyle = rgb(clair ? pal.atmoA : lueur, 0.5);
        tc.fillRect(0, 0, 1, 1);
        const grille = ctx.createPattern(tuile, "repeat");
        if (grille) {
          ctx.globalAlpha = clair ? 0.13 : 0.22;
          ctx.fillStyle = grille;
          ctx.fillRect(0, 0, l, h);
          ctx.globalAlpha = 1;
        }
      }

      /* 4. THE FADE-OUT. The light dies towards the bottom right: that is
            what gives the beam a DIRECTION. Without it the page is uniformly
            blue and the origin is lost — yet the origin is what makes all the
            difference between a light and a background colour.

            ⚠️ IT IS DIAGONAL, SO IT FALLS TWICE AS FAST ON THE RIGHT EDGE AS
            ON THE BOTTOM: a gradient from (0,0) to (l,h) has already covered
            two thirds of its run at half width. The stops are pushed back
            accordingly, otherwise that edge darkens abruptly with nothing
            announcing it.

            In light mode, white is what fades instead of midnight blue: the
            light dies towards the paper, not towards the shadow. */
      const eteint = clair ? ([255, 255, 255] as const) : abysse;
      const fin = ctx.createLinearGradient(0, 0, l, h);
      fin.addColorStop(0, rgb(eteint, 0));
      fin.addColorStop(0.5, rgb(eteint, clair ? 0.26 : 0.12));
      fin.addColorStop(1, rgb(eteint, clair ? 0.72 : 0.42));
      ctx.fillStyle = fin;
      ctx.fillRect(0, 0, l, h);

      /* 5. The four corners picked up again: that is what keeps the field
            from looking like an image laid on the page. The vignette is wide
            and very gradual — a short vignette makes a porthole. */
      const coins = ctx.createRadialGradient(
        l * 0.5,
        h * 0.5,
        diag * 0.26,
        l * 0.5,
        h * 0.5,
        diag * 0.74,
      );
      coins.addColorStop(0, rgb(eteint, 0));
      coins.addColorStop(1, rgb(eteint, clair ? 0.5 : 0.34));
      ctx.fillStyle = coins;
      ctx.fillRect(0, 0, l, h);
    };

    const redimensionner = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const l = hote.clientWidth;
      const h = hote.clientHeight;
      canvas.width = Math.max(1, Math.round(l * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dessiner();
    };

    const ro = new ResizeObserver(redimensionner);
    ro.observe(hote);
    redimensionner();

    /* ⚠️ THE THEME IS WATCHED ON `<html>`, NOT LISTENED TO ON AN EVENT. The
       theme button merely sets `data-theme` on the root: it emits nothing,
       and nothing guarantees it ever will. Observing the attribute works
       however it is set — including by the blocking script in the `layout`,
       before this component even exists. */
    const oeil = new MutationObserver(dessiner);
    oeil.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      ro.disconnect();
      oeil.disconnect();
    };
  }, []);

  return (
    <div className="site-backdrop" aria-hidden="true">
      <canvas ref={toile} className="fond-marine" />
    </div>
  );
}
