/* ---------------------------------------------------------------------------
   Chez quel fournisseur la requete part.

   ⚠️ UN MEME MODELE EST SERVI PAR PLUSIEURS FOURNISSEURS, ET LEURS LATENCES
   N'ONT RIEN A VOIR. Par defaut, OpenRouter repartit la charge : la meme
   question peut repondre en 3 s ou en 90 s selon qui la recoit — mesure
   faite, le meme tour a pris 5 s et 98 s a quelques minutes d'intervalle.
   Pour un chat, c'est la latence qui compte, pas le prix au jeton : on
   demande donc explicitement le fournisseur le plus rapide, et on ecarte
   ceux qui se sont montres durablement lents.

   Reglable sans toucher au code :
     OPENROUTER_PROVIDER_SORT      latency (defaut) | throughput | price
     OPENROUTER_IGNORE_PROVIDERS   liste (defaut : parasail) ; vide = personne
     OPENROUTER_PROVIDER_ORDER     ordre explicite ; prime sur le tri
     OPENROUTER_ALLOW_FALLBACKS    0 pour interdire tout autre fournisseur
--------------------------------------------------------------------------- */

export type ProviderRouting = {
  sort?: "latency" | "throughput" | "price";
  order?: string[];
  ignore?: string[];
  allow_fallbacks: boolean;
};

type Env = { sort?: string; ignore?: string; order?: string; fallbacks?: string };

const SORTS = ["latency", "throughput", "price"] as const;

/** Une liste ecrite a la main : virgules, points-virgules, espaces. */
const liste = (v: string) =>
  v
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function providerRouting(env: Env): ProviderRouting {
  const ignore = liste(env.ignore ?? "parasail").map((x) => x.toLowerCase());
  const order = env.order === undefined ? [] : liste(env.order);
  const sort = SORTS.find((s) => s === (env.sort ?? "").trim().toLowerCase());

  return {
    /* Un ordre explicite remplace le tri : les deux ensemble n'ont pas de
       sens, OpenRouter suivrait l'ordre. */
    ...(order.length ? { order } : { sort: sort ?? "latency" }),
    ...(ignore.length ? { ignore } : {}),
    allow_fallbacks: !["0", "false", "non"].includes((env.fallbacks ?? "1").trim().toLowerCase()),
  };
}

/** Le routage tel que les requetes l'utilisent, lu dans l'environnement. */
export const PROVIDER_ROUTING = providerRouting({
  sort: process.env.OPENROUTER_PROVIDER_SORT,
  ignore: process.env.OPENROUTER_IGNORE_PROVIDERS,
  order: process.env.OPENROUTER_PROVIDER_ORDER,
  fallbacks: process.env.OPENROUTER_ALLOW_FALLBACKS,
});
