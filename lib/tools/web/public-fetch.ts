import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

/* ---------------------------------------------------------------------------
   Fetching from the Internet only — never from this machine or its network.

   The app runs on the user's machine: a URL chosen by a model (or by a web
   page it read) must not reach `127.0.0.1:3777/api/…`, the router's admin
   page, a cloud metadata endpoint or a LAN printer. So:

   - every address a name resolves to must be PUBLIC (`isPublicIp`: the
     private, loopback, link-local, shared, benchmarking, documentation,
     multicast and reserved ranges are refused, in IPv4, IPv6, and the IPv6
     forms that carry an IPv4 — mapped, compatible, NAT64, 6to4);
   - ⚠️ THE CHECKED ADDRESS IS THE ONE CONNECTED TO. Checking with a DNS
     lookup and then letting `fetch` resolve the name again leaves a window:
     a name with a zero TTL answers a public address to the check and
     127.0.0.1 to the connection (DNS rebinding). The request is made with
     `node:http(s)` and a `lookup` that returns the address already checked;
     TLS still verifies the certificate against the NAME;
   - redirects are followed by hand, to any public address (http → https,
     apex → www), each hop checked the same way, at most `maxRedirects`.

   Used by WebFetch; the plugins' `ctx.fetch` should go through it too.
--------------------------------------------------------------------------- */

type Range = [number, number];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

/* IPv4 ranges that are not the public Internet, as [first, last] integers. */
const V4_BLOCKED: Range[] = (
  [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and 255.255.255.255 broadcast
  ] as Array<[string, number]>
).map(([base, bits]) => {
  const start = v4ToInt(base);
  return [start, start + 2 ** (32 - bits) - 1] as Range;
});

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([a, b]) => n >= a && n <= b);
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a trailing
    dotted IPv4 turned into two groups), or `null` if unreadable. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = v4ToInt(v4[1]);
    s = `${s.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4Of = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  /* `::` unspecified, `::1` loopback, `::a.b.c.d` (IPv4-compatible,
     deprecated: `::127.0.0.1`), `::ffff:a.b.c.d` (IPv4-mapped): never. */
  if (zeroUpTo(6)) return false;
  if (zeroUpTo(5) && g[5] === 0xffff) return false;
  /* NAT64 (64:ff9b::/96): the IPv4 it carries decides. The local-use
     prefix 64:ff9b:1::/48 is the operator's own network. */
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(v4Of(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return false;
  /* 6to4 (2002::/16): the IPv4 in groups 1–2 decides. */
  if (g[0] === 0x2002) return isPublicV4(v4Of(g[1], g[2]));
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  return true;
}

/** Is this IP literal an address of the public Internet? */
export function isPublicIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) return isPublicV4(bare);
  if (net.isIPv6(bare.replace(/%.*$/, ""))) return isPublicV6(bare);
  return false;
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** The addresses to connect to for this URL, all of them public — or an
    error saying why not. Refuses what is not http(s) (or ws(s) when
    `websocket`). */
export async function resolvePublic(url: URL, opts: { websocket?: boolean } = {}): Promise<ResolvedAddress[]> {
  const allowed = opts.websocket ? ["ws:", "wss:"] : ["http:", "https:"];
  if (!allowed.includes(url.protocol)) throw new Error(opts.websocket ? "Only ws and wss are accepted." : "Only http and https are accepted.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) throw new Error("Local or private address refused.");
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new Error("Local or private address refused.");
    return [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => !isPublicIp(a.address))) throw new Error(`${host} does not resolve to a public address.`);
  return addrs.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/** Refuses what is not http(s) or does not resolve to a public address.
    ⚠️ A check alone: the caller that then connects by NAME resolves it
    again — prefer `publicFetch`, which connects to the checked address. */
export async function assertPublic(url: URL): Promise<void> {
  await resolvePublic(url);
}

export type PublicFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Beyond this many bytes (decompressed), reading stops: `truncated`. */
  maxBytes: number;
  maxRedirects?: number;
  /** Called before every hop, the first included: throw to refuse it (a
      plugin's allowed hosts). */
  beforeHop?: (url: URL) => void;
};

export type PublicFetchResult = { status: number; url: string; headers: Record<string, string>; body: Buffer; truncated: boolean };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/* Credentials never follow a redirect to another origin (as in `fetch`). */
const CREDENTIALS = ["authorization", "cookie", "proxy-authorization"];

/** GET/POST a public URL, redirects included, connecting only to checked
    addresses. A non-2xx status is a result, not an error. */
export async function publicFetch(rawUrl: string, opts: PublicFetchOptions): Promise<PublicFetchResult> {
  let url = new URL(rawUrl);
  let method = (opts.method ?? "GET").toUpperCase();
  let body = opts.body;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const maxRedirects = opts.maxRedirects ?? 5;
  for (let hop = 0; ; hop++) {
    opts.beforeHop?.(url);
    const addrs = await resolvePublic(url);
    const res = await request(url, addrs[0], method, headers, body, opts.signal);
    const location = res.headers.location;
    if (REDIRECTS.has(res.statusCode ?? 0) && typeof location === "string") {
      res.resume();
      if (hop >= maxRedirects) throw new Error(`Too many redirects (more than ${maxRedirects}).`);
      const next = new URL(location, url);
      if (next.origin !== url.origin) for (const h of Object.keys(headers)) if (CREDENTIALS.includes(h.toLowerCase())) delete headers[h];
      /* 303, and 301/302 after a POST, continue as a GET without a body. */
      if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      url = next;
      continue;
    }
    const { data, truncated } = await readBody(res, opts.maxBytes);
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(", ") : v;
    return { status: res.statusCode ?? 0, url: url.toString(), headers: flat, body: data, truncated };
  }
}

function request(url: URL, addr: ResolvedAddress, method: string, headers: Record<string, string>, body: string | undefined, signal?: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    /* The only resolution this request gets: the address checked above.
       Node asks with `all: true` when it tries several families. */
    const lookup = (_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
      if (options?.all) cb(null, [{ address: addr.address, family: addr.family }]);
      else cb(null, addr.address, addr.family);
    };
    const req = lib.request(
      url,
      {
        method,
        headers: { "accept-encoding": "gzip, deflate, br", ...headers, ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
        lookup: lookup as unknown as typeof import("node:dns").lookup,
        signal,
      },
      resolve,
    );
    req.on("error", reject);
    if (body !== undefined && method !== "GET" && method !== "HEAD") req.end(body);
    else req.end();
  });
}

/** The body, decompressed, bounded to `max` bytes. */
function readBody(res: http.IncomingMessage, max: number): Promise<{ data: Buffer; truncated: boolean }> {
  const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
  let stream: Readable = res;
  if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
  else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
  else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (truncated: boolean) => {
      if (done) return;
      done = true;
      resolve({ data: Buffer.concat(chunks), truncated });
    };
    stream.on("data", (chunk: Buffer) => {
      if (done) return;
      const room = max - size;
      chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      size += Math.min(chunk.length, room);
      if (size >= max) {
        finish(true);
        res.destroy();
        if (stream !== res) stream.destroy();
      }
    });
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      reject(e);
    };
    stream.on("end", () => finish(false));
    stream.on("error", fail);
    res.on("error", fail);
    /* A connection dropped mid-answer (or the time limit) must not leave
       the call waiting for an `end` that never comes. */
    res.on("close", () => {
      if (!res.complete) fail(new Error("The connection closed before the end of the answer."));
    });
  });
}
