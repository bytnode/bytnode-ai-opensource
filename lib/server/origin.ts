/* ---------------------------------------------------------------------------
   Refusing requests that come from another site.

   The app runs on the user's machine, with no password: its routes write
   to the workspace, launch agents that run commands, open system dialogs.
   Any web page opened in the browser can send a "simple" POST (`text/plain`
   body) to `http://localhost:3777/api/…` without triggering a CORS
   preflight — the response stays unreadable to it, but the action itself
   is done. This is the classic local-server issue.

   The browser marks these requests: `Sec-Fetch-Site` is `cross-site` (or
   `same-site` from another port), and `Origin` carries the other site. The
   app, meanwhile, always speaks from its own origin; a non-browser client
   (curl, a script) sends neither and passes. Pure, tested; wired by
   `proxy.ts` on every `/api` route.
--------------------------------------------------------------------------- */

type Headers = { get(name: string): string | null };

/** The reason for the refusal, or `null` if the request is from home. */
export function crossSiteReason(headers: Headers): string | null {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return `${site} request`;
  const origin = headers.get("origin");
  if (!origin || origin === "null") return origin === "null" ? "opaque origin" : null;
  const host = headers.get("host");
  if (!host) return null;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return "unreadable origin";
  }
  return o.host.toLowerCase() === host.toLowerCase() ? null : `origin ${o.host}`;
}
