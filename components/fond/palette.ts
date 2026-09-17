/* ---------------------------------------------------------------------------
   LA PALETTE DU NŒUD — un module NEUTRE, ni client ni serveur.

   ⚠️ ELLE NE PEUT PAS VIVRE DANS UN FICHIER `"use client"`, ET LA RAISON EST
   SUBTILE. Un composant SERVEUR qui importe une valeur d'un module client ne
   recoit pas la valeur mais une REFERENCE CLIENT, un objet-proxy que Next
   resoudra dans le navigateur. `Object.entries` d'un tel proxy rend un tableau
   VIDE — sans erreur, sans avertissement. Sortie ici, la palette est une simple
   donnee : la toile la lit dans le navigateur, une page serveur la lit sur le
   serveur, et les deux voient la meme chose.

   ⚠️ UNE PALETTE N'EST PAS UNE LISTE DE COULEURS, C'EST UNE LISTE DE ROLES.
   Quatre suffisent, et chacun est tenu par une seule teinte d'un bout a l'autre
   de la scene :

     loin    la structure au fond        — l'air, vers lequel tout s'eteint
     pres    la structure au premier plan — la matiere de la maille
     sommet  les points de decision      — ce qui n'est pas une arete
     eclat   ce qui brille               — speculaire, jour du limbe, blancs

   Rien d'autre n'est ecrit en dur dans le rendu : ni le fond, ni l'objet, ni le
   chrome de la page. `atmoA` et `atmoB` ne sont que les deux nappes de l'air
   derriere l'objet.

   Cette direction est le resultat d'une longue serie d'essais comparee sur
   `/backgrounds-preview/noeud-objet` ; les seize palettes explorees et les cinq
   autres retenues y vivent encore, en laboratoire.
--------------------------------------------------------------------------- */

export type Palette = {
  nom: string;
  /** ⚠️ LE NEON NE VIENT PAS DES TEINTES, IL VIENT DE LA COMPOSITION. Sur du
      noir, tout ce qu'on peint en additif S'AJOUTE, donc brille : une palette
      terreuse rendue avec le meme halo qu'une palette electrique redevient
      fluorescente. Ces facteurs sont donc ce qui separe vraiment une matiere
      d'une lumiere, et aucune couleur ne peut le faire a leur place.

      `halo`  multiplie la diffusion, le speculaire et la lueur du limbe : au
              dessus de 1 l'objet EMET, en dessous il RENVOIE.
      `corps` multiplie le remplissage des faces : plus il monte, moins la coque
              est un fil de fer — c'est ce qui rend l'interieur moins sombre.
      `ambiance` ne touche qu'a l'air autour de l'objet : on peut donc calmer la
              piece sans eteindre la sphere, ou l'inverse.
      `lueur` est l'intensite du filet de lumiere pose sur l'arete du bouton
              principal. C'est le detail le plus proche du lecteur, donc celui
              qui donne le ton a toute la page. */
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

/** ⚠️ « MARINE & SABLE » — LA DIRECTION RETENUE POUR LE SITE.
 *
 *  Les quatre roles sont desatures A LUMINOSITE CONSTANTE par rapport au cyan
 *  d'origine : chaque teinte garde sa VALEUR et perd de sa CHROMA. Comme toute
 *  la profondeur de la scene est portee par des ecarts de valeur — lointain
 *  contre proche, jour contre ombre —, elle est rigoureusement inchangee.
 *  Assombrir pour calmer aurait au contraire ferme la coque.
 *
 *  ⚠️ LE ROUGE RESTE BIEN EN DESSOUS DU BLEU — 0,58 du canal bleu sur `pres`,
 *  0,44 sur `loin`. C'est la marge qui empeche le melange additif avec le sable
 *  des sommets de faire basculer l'ensemble vers le mauve, derive rencontree a
 *  chaque fois que ce rapport est monte.
 */
export const MARINE: Palette = {
  nom: "Marine & sable",
  loin: [56, 86, 128],
  pres: [136, 177, 234],
  sommet: [210, 200, 176],
  eclat: [230, 238, 250],
  atmoA: [40, 80, 134],
  atmoB: [62, 74, 100],
  /* ⚠️ « PLUS LUMINEUSE » ET « MOINS SOMBRE » SONT DEUX REGLAGES DIFFERENTS.
     `halo` au-dessus de 1 : la sphere ne se contente plus de renvoyer la
     lumiere, elle en ajoute — c'est ce qui la rend lumineuse. `corps` gouverne
     le remplissage des faces, donc le noir entre les aretes : monter le halo
     n'y aurait rien change, la coque serait devenue une cage brillante autour
     d'un vide toujours aussi noir. 1,18 et non 1,5 : au-dela, l'hemisphere
     arriere cesse de se lire a travers l'avant et l'objet perd son volume. */
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

/** Ecarte les canaux de leur moyenne : la teinte gagne en CHROMA sans changer
    de clarte. C'est la seule facon de rendre un bleu plus vif sans le rendre
    plus clair — l'eclaircir le ferait virer au bleu roi, la saturation percue
    du marine montant avec sa luminosite. */
export const saturer = (c: readonly [number, number, number], k: number) => {
  const m = (c[0] + c[1] + c[2]) / 3;
  const b = (v: number) => Math.max(0, Math.min(255, m + (v - m) * k));
  return [b(c[0]), b(c[1]), b(c[2])] as const;
};
