"use client";

import { useEffect, useRef } from "react";
import { MARINE, mel, rgb, saturer } from "./palette";
import "./fond.css";

/* ---------------------------------------------------------------------------
   THE BACKDROP OF THE WHOLE APPLICATION  ·  a black, three navy reflections

   bytnode.com's backdrop, ported as is (`app_web/frontend/components/noeud/
   fond.tsx`, direction "Black & reflections", 2026-09-21): the app wears the
   site's ground. Keep the two in step — the scene's values live in
   `palette.ts` (`MARINE.scene`), nothing is hard-coded here.

   ⚠️ THE GROUND IS BLACK, AND EVERYTHING BLUE IS LIGHT. The ground's pigment
   is a barely blue black, laid OPAQUE (a transparent navy on the page's
   black drifted to grey). On top, three REFLECTIONS: layers of muted navy,
   wide, their edge fully blended, all on the same diagonal — the top-left
   corner, high on the right, low on the left.

   ⚠️ A REFLECTION, NOT A BEAM. Narrow, sharp rays were tried, in navy then
   additive: they read "neon" and "stuck on the page". What makes a
   reflection is the blended edge (`nettete` 0), the width, and the
   DIFFUSION: each layer is painted twice, first three times wider and very
   faint — the glow it leaves in the air —, then itself. That first pass is
   what melts it into the black.

   ⚠️ EACH LAYER IS AN ELLIPSE, NOT A GRADIENT RECTANGLE. A rectangle needs
   two gradients — one across for the soft edges, one lengthwise for the
   fade-out — and two gradients do not multiply in a single fill. A very
   elongated ellipse, obtained by distorting the frame before painting a
   radial gradient, gives both at once: edges blended both ways, no seam.

   ⚠️ THE LIGHT VARIANT KEEPS THE FORMER GEOMETRY — four oblique navy veils
   from the top left (`RAYONS`) on a very pale blue. It was not revised with
   the black ground: the light theme has no black.

   ⚠️ NOTHING IS ANIMATED AND NOTHING IS INTERACTIVE HERE. Painted once per
   resize and once per theme change, it installs no loop — which is what lets
   it sit behind every page without costing anything per frame.
--------------------------------------------------------------------------- */

/** Where the knot sits on bytnode.com's home page, in screen fractions: the
    light theme lays a glow above it. Kept identical to the site's. */
const OBJ = { x: 0.67, y: 0.5 };

/** The common tilt of the layers, from the horizontal. */
const DESC = (45 * Math.PI) / 180;

/** The four veils of the LIGHT THEME: origin in screen fractions, tilt,
    half-length and half-width in diagonal fractions, core opacity. In dark,
    the scene's `nappes` are used. */
const RAYONS: Array<[number, number, number, number, number, number]> = [
  [0.04, -0.1, 1, 0.52, 0.109, 0.36],
  /* The brightest and thinnest: the one read as THE ray. It stays navy —
     painted with the whites' hue it made a GREY streak across the page. */
  [0.21, -0.12, 0.93, 0.48, 0.06, 0.62],
  /* The wide, muted one: thickness without the first two's brightness. */
  [0.39, -0.14, 1.06, 0.46, 0.137, 0.24],
  /* A thread far to the right: the right half does not close at once. */
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
    const scene = pal.scene;

    /* The LIGHT THEME's hues, drawn from the four roles. */
    const marine = mel(pal.loin, pal.atmoA, 0.7);
    /* The light veils' hue: the blue of the air, raised in chroma. At 1.55
       the red/blue ratio drops to 0.30 — a frank navy. */
    const rayon = saturer(mel(pal.atmoA, pal.pres, 0.58), 1.55);
    /* ⚠️ THE LIGHT VARIANT IS NOT AN INVERSION — black veils on white would
       be shadows. The ground becomes a very pale blue, the veils barely more
       SATURATED than it: light through tinted glass. */
    const pale = mel([255, 255, 255], pal.atmoA, 0.07);

    const dessiner = () => {
      const l = hote.clientWidth;
      const h = hote.clientHeight;
      if (l < 2 || h < 2) return;
      const clair = document.documentElement.dataset.theme === "light";
      ctx.clearRect(0, 0, l, h);

      const etroit = l < 980;
      const ox = l * (etroit ? 0.5 : OBJ.x);
      const oy = h * (etroit ? 0.72 : OBJ.y);
      const diag = Math.hypot(l, h);

      /* A round layer whose opacity falls gently. The middle stops are not
         decorative — a two-stop gradient falls linearly and leaves a circle
         visible halfway. */
      const nappe = (x: number, y: number, r: number, c: readonly [number, number, number], a: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgb(c, a));
        g.addColorStop(0.35, rgb(c, a * 0.62));
        g.addColorStop(0.68, rgb(c, a * 0.22));
        g.addColorStop(1, rgb(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, l, h);
      };

      /* An elongated layer. `n`, the edge's sharpness from 0 to 1: at 0 the
         five historic stops (a fully blended edge); at 1 the plateau holds to
         half the radius, then the light drops within a quarter. */
      const faisceau = (x: number, y: number, ang: number, L: number, W: number, c: readonly [number, number, number], a: number, n = 0) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.scale(L, W);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgb(c, a));
        g.addColorStop(0.18 + 0.32 * n, rgb(c, a * 0.92));
        g.addColorStop(0.45 + 0.25 * n, rgb(c, a * (0.44 - 0.2 * n)));
        g.addColorStop(0.72 + 0.16 * n, rgb(c, a * (0.12 - 0.08 * n)));
        g.addColorStop(1, rgb(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      };

      /* 1. THE GROUND: what holds every area no reflection reaches. Dark: the
            scene's pigment, OPAQUE. Light: a very pale blue, opaque too. */
      if (clair) {
        ctx.fillStyle = rgb(pale, 1);
        ctx.fillRect(0, 0, l, h);
      } else {
        const sol = ctx.createLinearGradient(0, 0, 0, h);
        sol.addColorStop(0, rgb(scene.solHaut, 1));
        sol.addColorStop(0.55, rgb(mel(scene.solHaut, scene.solBas, 0.62), 1));
        sol.addColorStop(1, rgb(scene.solBas, 1));
        ctx.fillStyle = sol;
        ctx.fillRect(0, 0, l, h);
      }

      /* 2. THE LIGHT. Dark: the scene's reflections; light: the four veils,
            at 0.34 of their opacity — the useful contrast is much lower on a
            pale ground. */
      const sc = clair ? null : scene;
      const k = clair ? 0.34 : 1;
      const lum = sc ? sc.lumiere : rayon;
      const lg = sc ? sc.largeur : 1;
      const it = sc ? sc.intensite : 1;
      const nt = sc ? sc.nettete : 0;
      const dif = sc ? sc.diffusion : 0;
      const sources = sc ? sc.nappes : RAYONS;
      for (const [x, y, incl, L, W, a] of sources) {
        /* The diffusion first, under the layer: three times wider, very
           faint — the glow it leaves in the air. */
        if (dif > 0) faisceau(l * x, h * y, DESC * incl, diag * L * 1.08, diag * W * lg * 3.2, lum, a * k * it * 0.16 * dif, 0);
        faisceau(l * x, h * y, DESC * incl, diag * L, diag * W * lg, lum, a * k * it, nt);
      }
      if (clair) {
        /* The light veils' source, out of frame. */
        nappe(l * 0.17, h * -0.16, diag * 0.28, lum, 0.12 * k);
        /* The right edge's breath, its centre out of frame. */
        nappe(l * 1.06, h * 0.3, diag * 0.5, marine, 0.13 * k);
        nappe(ox - l * 0.05, oy - h * 0.4, diag * 0.34, lum, 0.07 * k);
      }

      /* 3. THE DOT GRID, made ONCE in a 22 px tile then repeated: it crosses
            light and shadow alike — that gives the whole its surface. */
      const tuile = document.createElement("canvas");
      tuile.width = PAS;
      tuile.height = PAS;
      const tc = tuile.getContext("2d");
      if (tc) {
        tc.fillStyle = rgb(sc ? mel(sc.solHaut, sc.lumiere, 0.5) : pal.atmoA, 0.5);
        tc.fillRect(0, 0, 1, 1);
        const grille = ctx.createPattern(tuile, "repeat");
        if (grille) {
          ctx.globalAlpha = sc ? sc.trame : 0.13;
          ctx.fillStyle = grille;
          ctx.fillRect(0, 0, l, h);
          ctx.globalAlpha = 1;
        }
      }

      /* 4. THE FADE-OUT towards the bottom right. Dark: towards the ground's
            bottom PIGMENT, never a black blacker than the ground. Light:
            towards white — the light dies into paper, not into shadow. ⚠️ It
            is diagonal, so it falls twice as fast on the right edge as at the
            bottom: the stops are pushed back accordingly. */
      const eteint = sc ? sc.solBas : ([255, 255, 255] as const);
      const ex = sc ? sc.extinction * 2 : 1;
      const fin = ctx.createLinearGradient(0, 0, l, h);
      fin.addColorStop(0, rgb(eteint, 0));
      fin.addColorStop(0.5, rgb(eteint, clair ? 0.26 : 0.12 * ex));
      fin.addColorStop(1, rgb(eteint, clair ? 0.72 : 0.42 * ex));
      ctx.fillStyle = fin;
      ctx.fillRect(0, 0, l, h);

      /* 5. The four corners taken back: the field does not read as a picture
            laid on the page. Wide and very gradual — a short vignette makes a
            porthole. */
      const coins = ctx.createRadialGradient(l * 0.5, h * 0.5, diag * 0.26, l * 0.5, h * 0.5, diag * 0.74);
      coins.addColorStop(0, rgb(eteint, 0));
      coins.addColorStop(1, rgb(eteint, clair ? 0.5 : 0.34 * ex));
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

    /* ⚠️ THE THEME IS WATCHED ON `<html>`, not listened to as an event: the
       toggle only sets `data-theme` on the root and emits nothing. */
    const oeil = new MutationObserver(dessiner);
    oeil.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

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
