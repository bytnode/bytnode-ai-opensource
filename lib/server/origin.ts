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

   ⚠️ DNS REBINDING. A page on `http://evil.test:3777/` whose name is then
   re-pointed at 127.0.0.1 IS same-origin with itself: `Origin` equals
   `Host` (`evil.test:3777`), and the browser marks the request same-origin.
   Only the Host tells: the app is served on a loopback NAME
   (`127.0.0.1`, `localhost`, `[::1]`) and on one port, so any other Host
   is refused before the Origin is even looked at. A client that sends no
   Host at all (HTTP/1.0) is only let through when it carries no Origin
   either — a browser always sends one with its POSTs.
--------------------------------------------------------------------------- */

type Headers = { get(name: string): string | null };

/** The names the app is served on (it listens on 127.0.0.1 only). */
const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type OriginOptions = {
  /** The port the server listens on (`process.env.PORT`, set by `next
      start` / `next dev`). Unknown: any port is accepted. */
  port?: string | number;
};

/** `host[:port]` split, the port defaulting to 80 (the app serves http). */
function splitHost(value: string): { name: string; port: string } | null {
  const m = value.trim().toLowerCase().match(/^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/);
  return m ? { name: m[1], port: m[2] ?? "80" } : null;
}

/** The reason for the refusal, or `null` if the request is from home. */
export function crossSiteReason(headers: Headers, opts: OriginOptions = {}): string | null {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return `${site} request`;
  const origin = headers.get("origin");
  const host = headers.get("host")?.trim() ?? "";
  if (host) {
    const h = splitHost(host);
    if (!h || !LOOPBACK_NAMES.has(h.name)) return `host ${host}`;
    if (opts.port !== undefined && opts.port !== "" && h.port !== String(opts.port)) return `host ${host}`;
  }
  if (!origin) return null;
  if (origin === "null") return "opaque origin";
  if (!host) return "origin without a host";
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return "unreadable origin";
  }
  if (o.protocol !== "http:") return `origin ${o.protocol}//${o.host}`;
  return o.host.toLowerCase() === host.toLowerCase() ? null : `origin ${o.host}`;
}
