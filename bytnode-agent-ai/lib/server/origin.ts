/* ---------------------------------------------------------------------------
   Refuser les requetes venues d'un autre site.

   L'application tourne sur la machine de l'utilisateur, sans mot de passe :
   ses routes ecrivent dans le dossier de travail, lancent des agents qui
   executent des commandes, ouvrent des boites de dialogue systeme. N'importe
   quelle page web ouverte dans le navigateur peut envoyer un POST
   « simple » (corps `text/plain`) vers `http://localhost:3777/api/…` sans
   declencher de preflight CORS — la reponse lui reste illisible, mais
   l'action, elle, est faite. C'est le classique du serveur local.

   Le navigateur marque ces requetes : `Sec-Fetch-Site` vaut `cross-site`
   (ou `same-site` depuis un autre port), et `Origin` porte l'autre site.
   L'application, elle, parle toujours depuis sa propre origine ; un client
   hors navigateur (curl, un script) n'envoie ni l'un ni l'autre et passe.
   Pur, teste ; branche par `proxy.ts` sur toutes les routes `/api`.
--------------------------------------------------------------------------- */

type Headers = { get(name: string): string | null };

/** La raison du refus, ou `null` si la requete est de la maison. */
export function crossSiteReason(headers: Headers): string | null {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return `requête ${site}`;
  const origin = headers.get("origin");
  if (!origin || origin === "null") return origin === "null" ? "origine opaque" : null;
  const host = headers.get("host");
  if (!host) return null;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return "origine illisible";
  }
  return o.host.toLowerCase() === host.toLowerCase() ? null : `origine ${o.host}`;
}
