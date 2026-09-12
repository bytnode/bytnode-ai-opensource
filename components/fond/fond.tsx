"use client";

import { useEffect, useRef } from "react";
import { MARINE, mel, rgb, saturer } from "./palette";
import "./fond.css";

/* ---------------------------------------------------------------------------
   LE FOND DE TOUTE L'APPLICATION  ·  une lumiere rasante en bleu de marine

   ⚠️ C'EST UNE LUMIERE, PAS UN DEGRADE. Des nappes rondes posees ici et la font
   un ciel; des FAISCEAUX obliques font une SCENE. Quatre d'entre eux descendent
   du haut de la page vers le bas a droite, separes par des couloirs sombres, et
   la lumiere meurt avant d'avoir traverse l'ecran. La difference se lit tout de
   suite : une nappe n'a pas d'origine, un faisceau vient de quelque part.

   Et il vient du MEME endroit que la lumiere du nœud, sur l'accueil : en haut,
   un peu a gauche. Le fond et l'objet sont eclaires par la meme source; sans
   cela l'oeil sent la contradiction sans pouvoir la nommer.

   ⚠️ CHAQUE FAISCEAU EST UNE ELLIPSE, PAS UN RECTANGLE DEGRADE. Un rectangle
   demande deux degrades — un en travers pour les bords doux, un en long pour
   l'extinction — et deux degrades ne se multiplient pas dans un seul
   remplissage. Une ellipse tres allongee, obtenue en deformant le repere avant
   de peindre un degrade radial, donne les deux d'un coup et en une seule
   passe : bords fondus dans les deux sens, aucune couture.

   ⚠️ QUATRE RAYONS ETROITS, SEPARES PAR DU NOIR. Une version anterieure n'en
   avait que trois, mais larges, et ils se recouvraient : l'ensemble se lisait
   comme UN SEUL gros faisceau, c'est-a-dire comme un degrade bleu. Un faisceau
   n'existe que par le noir qui le borde — c'est l'intervalle qui le designe,
   pas sa clarte. Aucun n'est parallele a un autre et aucun n'a la meme largeur:
   quatre rayons jumeaux feraient une rayure, quatre rayons distincts font une
   source qui se decompose.

   ⚠️ LE PLUS SOMBRE DE LA PAGE N'EST PAS DU NOIR, C'EST UN BLEU. Extinction et
   vignette ont d'abord ete peintes en `rgba(0,0,0,…)` : partout ou les rayons
   n'arrivaient pas, la page tendait vers le noir pur et l'ombre devenait un
   TROU. Peintes avec un bleu de nuit tres bas, elles tendent vers une couleur —
   l'ombre reste de la meme famille que la lumiere.

   ⚠️ ET LE BLEU EST **ASSOMBRI**, PAS TRANSPARENT. Poser le marine a faible
   opacite laisse remonter le noir de la page : le melange derive vers le
   gris-bleu et la page parait delavee. Ici la teinte est d'abord rabattue vers
   le noir, puis posee a forte opacite. Meme clarte finale, saturation bien plus
   haute — la couleur doit etre dans le pigment, pas dans la transparence.

   ⚠️ RIEN N'EST ANIME ET RIEN N'EST INTERACTIF ICI. C'est un fond au sens
   propre : peint une fois par redimensionnement et une fois par changement de
   theme, il n'installe aucune boucle. C'est ce qui permet de le poser sur TOUTES
   les pages, y compris la console, sans rien couter par image.
--------------------------------------------------------------------------- */

/** Ou se trouve le nœud sur l'accueil, en fractions d'ecran. ⚠️ CES DEUX
    VALEURS DOIVENT SUIVRE CELLES DE `sculpture.tsx` : le fond s'en sert pour
    ne pas poser sa lueur ailleurs que la ou l'objet la recoit. */
const OBJ = { x: 0.69, y: 0.495 };

/** L'inclinaison des rayons, comptee depuis l'horizontale.

    ⚠️ ELLE DECIDE AUSSI DE LEUR ECARTEMENT. Deux origines distantes de `dx` sur
    le bord haut ne sont separees, perpendiculairement a leur axe, que de
    `dx · sin(angle)` : a 37° un ecart de 245 px n'en donne que 147, a 45° il en
    donne 173. Redresser les rayons les eloigne donc les uns des autres — c'est
    ce qui leur permet d'etre a la fois epais et distincts. */
const DESC = (45 * Math.PI) / 180;

/** Un rayon : origine en fractions d'ecran, inclinaison, demi-longueur et
    demi-largeur en fractions de diagonale, opacite du coeur. */
const RAYONS: Array<[number, number, number, number, number, number]> = [
  [0.04, -0.1, 1, 0.52, 0.109, 0.36],
  /* Le plus clair et le plus mince : c'est lui qu'on lit comme LE rayon, les
     trois autres ne font que l'entourer. Il reste marine et ne blanchit pas —
     peint avec la teinte des blancs il faisait une trainee GRISE en travers de
     la page. Un faisceau plus clair doit l'etre par son intensite, pas en
     perdant sa couleur. */
  [0.21, -0.12, 0.93, 0.48, 0.06, 0.62],
  /* Le large et sourd : il donne de l'epaisseur sans jamais atteindre la clarte
     des deux premiers. */
  [0.39, -0.14, 1.06, 0.46, 0.137, 0.24],
  /* Le dernier, un filet, pose bien plus a droite : il empeche la moitie droite
     de se fermer d'un coup. */
  [0.53, -0.1, 0.88, 0.4, 0.04, 0.4],
];

/** Le pas de la trame de points, en pixels. */
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

    /* Les teintes de travail, toutes tirees des quatre roles. */
    const nuit = mel([0, 0, 0], pal.loin, 0.3);
    const marine = mel(pal.loin, pal.atmoA, 0.7);
    const lueur = mel(pal.atmoA, pal.pres, 0.55);
    /* La teinte des rayons : le bleu de l'air, remonte en chroma. A 1,55 le
       rapport rouge/bleu tombe a 0,30 — un marine franc; au-dela il vire au
       bleu roi, en deca il reste gris. */
    const rayon = saturer(mel(pal.atmoA, pal.pres, 0.58), 1.55);
    /* Le pigment du sol et celui de l'ombre, tous deux rabattus vers le noir. */
    const profond = mel([0, 0, 0], pal.atmoA, 0.16);
    const abysse = mel([0, 0, 0], nuit, 0.42);
    /* ⚠️ LA DECLINAISON CLAIRE N'EST PAS UNE INVERSION. Rendre le fond sombre
       en negatif donnerait des rayons NOIRS sur blanc, c'est-a-dire des ombres.
       Ce qui se conserve d'un theme a l'autre, ce n'est pas la valeur, c'est le
       ROLE : le sol reste ce sur quoi tout se pose, les rayons restent ce qui
       traverse. En clair, le sol devient un bleu tres pale et les rayons des
       voiles a peine plus SATURES que lui — une lumiere vue a travers du verre
       teinte plutot qu'une lampe dans le noir. La direction, elle, ne change
       pas : meme inclinaison, memes intervalles, meme extinction en diagonale. */
    const pale = mel([255, 255, 255], pal.atmoA, 0.07);

    const dessiner = () => {
      const l = hote.clientWidth;
      const h = hote.clientHeight;
      if (l < 2 || h < 2) return;
      const clair = document.documentElement.dataset.theme === "light";
      ctx.clearRect(0, 0, l, h);

      const etroit = l < 980;
      const ox = l * (etroit ? 0.5 : OBJ.x);
      /* 0,72 en etroit : la meme valeur que `sculpture.tsx`. Les deux doivent
         bouger ensemble, sans quoi la lueur du fond se pose ailleurs que
         l'objet qui la recoit. */
      const oy = h * (etroit ? 0.72 : OBJ.y);
      const diag = Math.hypot(l, h);

      /* Une nappe : un degrade radial dont l'opacite tombe en douceur. Les
         arrets intermediaires ne sont pas decoratifs — un degrade a deux arrets
         decroit lineairement et laisse un cercle visible a mi-parcours. */
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

      /* Un rayon. ⚠️ LE PROFIL A UN PLATEAU, ET C'EST LUI QUI FAIT LE FAISCEAU.
         Une decroissance reguliere depuis le centre donne une TACHE floue :
         nulle part la lumiere n'est franche, partout elle s'eteint. Un vrai
         rayon a un coeur d'intensite a peu pres constante, puis un bord qui
         tombe vite — d'ou ces cinq arrets. */
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

      /* 1. LE SOL. C'est lui qui decide de la couleur des zones que les rayons
            n'atteignent pas. En sombre : un marine profond, jamais du noir. En
            clair : un bleu tres pale, pose OPAQUE — il remplace le papier du
            theme, sinon les rayons flotteraient sur du blanc pur et la page
            n'aurait pas de sol du tout. */
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

      /* 2. LES RAYONS. Memes positions, memes largeurs, memes rapports d'un
            theme a l'autre : seule leur opacite change. Sur un sol pale, un
            voile a 0,30 de l'opacite du sombre suffit — le contraste utile est
            bien plus faible quand le fond est clair. */
      const k = clair ? 0.34 : 1;
      for (const [x, y, incl, L, W, a] of RAYONS) {
        faisceau(l * x, h * y, DESC * incl, diag * L, diag * W, rayon, a * k);
      }
      /* La source elle-meme, hors cadre : le point d'ou tout part. */
      nappe(l * 0.17, h * -0.16, diag * 0.28, rayon, 0.12 * k);
      /* Le souffle du bord droit. Son centre est HORS CADRE : on n'en voit que
         la queue, donc aucun cercle ne se devine, et ce bord — que les quatre
         rayons n'atteignent pas — ne se ferme plus d'un coup. */
      nappe(l * 1.06, h * 0.3, diag * 0.5, marine, 0.13 * k);
      /* Et sur l'accueil, la lueur juste au-dessus du nœud : le fond et l'objet
         partagent leur source, c'est ce qui les fait tenir ensemble. */
      nappe(ox - l * 0.05, oy - h * 0.4, diag * 0.34, rayon, 0.07 * k);

      /* 3. LA TRAME DE POINTS. Faite UNE FOIS dans une tuile de 22 px puis
            repetee : dessiner les deux mille cinq cents points a la main
            couterait autant d'appels a chaque redimensionnement, le motif n'en
            coute qu'un. Elle traverse aussi bien les rayons que l'ombre — c'est
            ce qui donne a l'ensemble sa surface, comme un papier. */
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

      /* 4. L'EXTINCTION. La lumiere meurt vers le bas a droite : c'est ce qui
            donne au faisceau une DIRECTION. Sans elle la page est uniformement
            bleue et l'origine se perd — or c'est l'origine qui fait toute la
            difference entre une lumiere et une couleur de fond.

            ⚠️ ELLE EST DIAGONALE, DONC ELLE TOMBE DEUX FOIS PLUS VITE SUR LE
            BORD DROIT QUE SUR LE BAS : un degrade de (0,0) a (l,h) a deja
            parcouru les deux tiers de sa course a mi-largeur. Les arrets sont
            repousses en consequence, sinon ce bord s'assombrit brutalement
            alors que rien ne l'annonce.

            En clair, c'est du blanc qui eteint au lieu du bleu de nuit : la
            lumiere meurt vers le papier, pas vers l'ombre. */
      const eteint = clair ? ([255, 255, 255] as const) : abysse;
      const fin = ctx.createLinearGradient(0, 0, l, h);
      fin.addColorStop(0, rgb(eteint, 0));
      fin.addColorStop(0.5, rgb(eteint, clair ? 0.26 : 0.12));
      fin.addColorStop(1, rgb(eteint, clair ? 0.72 : 0.42));
      ctx.fillStyle = fin;
      ctx.fillRect(0, 0, l, h);

      /* 5. Les quatre coins repris : c'est ce qui empeche le champ de paraitre
            une image posee sur la page. La vignette est large et tres
            progressive — une vignette courte fait un hublot. */
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

    /* ⚠️ LE THEME EST SURVEILLE SUR `<html>`, PAS ECOUTE SUR UN EVENEMENT. Le
       bouton de theme se contente de poser `data-theme` sur la racine : il
       n'emet rien, et rien ne garantit qu'il en emettra un jour. Observer
       l'attribut marche quelle que soit la facon dont il est pose — y compris
       par le script bloquant du `layout`, avant meme que ce composant existe. */
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
