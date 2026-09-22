/* ---------------------------------------------------------------------------
   THE KNOT'S PALETTE — a NEUTRAL module, neither client nor server.

   ⚠️ IT CANNOT LIVE IN A `"use client"` FILE, AND THE REASON IS SUBTLE. A
   SERVER component that imports a value from a client module does not
   receive the value but a CLIENT REFERENCE, a proxy object that Next will
   resolve in the browser. `Object.entries` of such a proxy returns an EMPTY
   array — no error, no warning. Kept out here, the palette is plain data: the
   canvas reads it in the browser, a server page reads it on the server, and
   both see the same thing.

   ⚠️ A PALETTE IS NOT A LIST OF COLOURS, IT IS A LIST OF ROLES. Four are
   enough, and each is held by a single hue from one end of the scene to the
   other:

     loin    the structure at the back      — the air, into which everything fades
     pres    the structure in the foreground — the substance of the mesh
     sommet  the decision points            — whatever is not an edge
     eclat   what shines                    — specular, the limb's daylight, whites

   Nothing else is hard-coded in the render: neither the background, nor the
   object, nor the page chrome. `atmoA` and `atmoB` are only the two layers of
   air behind the object.

   This direction is the outcome of a long series of trials compared on
   `/backgrounds-preview/noeud-objet`; the sixteen palettes explored and the
   five other shortlisted ones still live there, in the lab.
--------------------------------------------------------------------------- */

export type Palette = {
  nom: string;
  /** ⚠️ THE NEON DOES NOT COME FROM THE HUES, IT COMES FROM THE COMPOSITION.
      On black, everything painted additively ADDS UP, hence shines: an earthy
      palette rendered with the same halo as an electric palette turns
      fluorescent again. These factors are therefore what truly separates a
      material from a light, and no colour can do it in their place.

      `halo`  multiplies the diffusion, the specular and the limb's glow: above
              1 the object EMITS, below it REFLECTS.
      `corps` multiplies the fill of the faces: the higher it goes, the less the
              shell is a wireframe — this is what makes the inside less dark.
      `ambiance` only touches the air around the object: the room can thus be
              calmed without dimming the sphere, or the reverse.
      `lueur` is the intensity of the thread of light laid on the edge of the
              primary button. It is the detail closest to the reader, hence the
              one that sets the tone for the whole page. */
  halo?: number;
  corps?: number;
  ambiance?: number;
  lueur?: number;
  loin: readonly [number, number, number];
  pres: readonly [number, number, number];
  sommet: readonly [number, number, number];
  eclat: readonly [number, number, number];
  atmoA: readonly [number, number, number];
  atmoB: readonly [number, number, number];
};

/** ⚠️ "NAVY & SAND" — THE DIRECTION CHOSEN FOR THE SITE.
 *
 *  The four roles are desaturated AT CONSTANT LUMINANCE relative to the
 *  original cyan: each hue keeps its VALUE and loses CHROMA. Since all the
 *  depth of the scene is carried by value differences — far against near,
 *  daylight against shadow — it is rigorously unchanged. Darkening to calm
 *  things down would, on the contrary, have closed the shell.
 *
 *  ⚠️ RED STAYS WELL BELOW BLUE — 0.58 of the blue channel on `pres`, 0.44 on
 *  `loin`. That is the margin which keeps the additive blend with the sand of
 *  the vertices from tipping the whole thing towards mauve, a drift met every
 *  time this ratio was raised.
 */
export const MARINE: Palette = {
  nom: "Navy & sand",
  loin: [56, 86, 128],
  pres: [136, 177, 234],
  sommet: [210, 200, 176],
  eclat: [230, 238, 250],
  atmoA: [40, 80, 134],
  atmoB: [62, 74, 100],
  /* ⚠️ "BRIGHTER" AND "LESS DARK" ARE TWO DIFFERENT SETTINGS. `halo` above 1:
     the sphere no longer merely reflects light, it adds some — that is what
     makes it luminous. `corps` governs the fill of the faces, hence the black
     between the edges: raising the halo would have changed nothing there, the
     shell would have become a shiny cage around a void just as black. 1.18
     and not 1.5: beyond that, the rear hemisphere stops reading through the
     front and the object loses its volume. */
  ambiance: 0.96,
  halo: 1.12,
  corps: 1.18,
  lueur: 0.24,
};

export const mel = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  k: number,
) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k] as const;

export const rgb = (c: readonly [number, number, number], a: number) =>
  `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

/** Pushes the channels away from their mean: the hue gains CHROMA without
    changing lightness. It is the only way to make a blue more vivid without
    making it lighter — lightening it would turn it royal blue, the perceived
    saturation of navy rising with its luminance. */
export const saturer = (c: readonly [number, number, number], k: number) => {
  const m = (c[0] + c[1] + c[2]) / 3;
  const b = (v: number) => Math.max(0, Math.min(255, m + (v - m) * k));
  return [b(c[0]), b(c[1]), b(c[2])] as const;
};
