import { liveFeed, type LiveFeed } from "@/lib/bytnode/live";
import { normalizeSymbol, bytnodeSymbol } from "@/lib/plugins/shared/quote";
import { coveredSet, isQuote, quote, referenceQuote, withLive } from "@/lib/plugins/shared/prices";
import { readTransport } from "@/lib/tools/transport";

/* ---------------------------------------------------------------------------
   Live prices for a view: `GET /api/market/live?symbols=BTC/USDT,ETH/USDT`.

   An NDJSON stream that lasts as long as the view listens:
     - `{"type":"quote","quote":{…}}` — each pair priced once at the start
       (BytNode, else an account's exchange: `quote()`), then at every
       trade BytNode's WebSocket carries for it, at most every `EVERY_MS`
       per pair, its changes worked out against the REST reading; a pair
       no trade prices is read again every `QUIET_MS`;
     - `{"type":"error","symbol":…,"error":…}` — a pair with no price at
       the start, and why (a live trade replaces it);
     - `{"type":"status","state":"live"|"connecting"|"unavailable"|"idle",
       "problem":…}` — whether live prices come, and why not;
     - an empty line every `PING_MS`, so a dead connection is noticed.
   The pairs are wanted on the app's ONE connection
   (`lib/bytnode/live.ts`) while the stream is open, and let go with it.
--------------------------------------------------------------------------- */

const EVERY_MS = 500;
const PING_MS = 15_000;
const STATUS_MS = 2_000;
const QUIET_MS = 30_000;
const MAX_SYMBOLS = 60;

export async function GET(req: Request) {
  const { bytnodeKey, exchangeAccounts } = readTransport(req.headers);
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => normalizeSymbol(s)).filter((s): s is string => !!s))].slice(0, MAX_SYMBOLS);
  const key = bytnodeKey.trim();
  const encoder = new TextEncoder();
  const cleanup: Array<() => void> = [];
  let open = true;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stop = () => {
    if (!open) return;
    open = false;
    for (const fn of cleanup.splice(0)) fn();
    try {
      controller?.close();
    } catch {
      /* already closed */
    }
  };
  const write = (text: string) => {
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      stop();
    }
  };
  const send = (event: unknown) => write(`${JSON.stringify(event)}\n`);
  /* When each pair last got a price (a trade, or a reading). */
  const priced = new Map<string, number>();

  /* A pair as the app reads it now: BytNode live, its REST reading, or an
     account's exchange. */
  const reading = async (symbol: string) => {
    const p = await quote(symbol, { bytnodeKey: key, accounts: exchangeAccounts, signal: req.signal });
    if (!open) return;
    priced.set(symbol, Date.now());
    send(isQuote(p) ? { type: "quote", quote: p } : { type: "error", symbol, error: p.error });
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      controller = c;
      req.signal.addEventListener("abort", stop, { once: true });
      const ping = setInterval(() => write("\n"), PING_MS);
      cleanup.push(() => clearInterval(ping));

      /* Each pair once; then again every QUIET_MS for a pair no trade has
         priced meanwhile (a pair BytNode does not cover, read on an
         exchange; live prices unavailable, the REST reading — kept ten
         minutes, so no BytNode request is spent on it). */
      for (const symbol of symbols) void reading(symbol);
      const quiet = setInterval(() => {
        for (const symbol of symbols) if (Date.now() - (priced.get(symbol) ?? 0) >= QUIET_MS) void reading(symbol);
      }, QUIET_MS);
      cleanup.push(() => clearInterval(quiet));
      if (!key) return;

      /* Then every trade of a pair BytNode covers, at most every
         EVERY_MS per pair. */
      const covered = await coveredSet(key, req.signal);
      if (!open) return;
      const feed: LiveFeed = liveFeed(key);
      let said = "";
      const status = () => {
        const now = JSON.stringify({ state: feed.state, problem: feed.problem });
        if (now === said) return;
        said = now;
        send({ type: "status", state: feed.state, problem: feed.problem });
      };
      const watching = setInterval(status, STATUS_MS);
      cleanup.push(() => clearInterval(watching));

      for (const symbol of symbols.filter((s) => !covered || covered.has(bytnodeSymbol(s)))) {
        let last = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const push = async () => {
          timer = null;
          last = Date.now();
          const tick = feed.last(bytnodeSymbol(symbol));
          if (!tick) return;
          const ref = await referenceQuote(symbol, key);
          if (!open) return;
          priced.set(symbol, Date.now());
          send({ type: "quote", quote: "error" in ref ? { symbol, price: tick.price, source: "bytnode", at: new Date(tick.at).toISOString() } : withLive(ref, tick) });
        };
        const unwatch = feed.watch(bytnodeSymbol(symbol), () => {
          if (timer) return;
          timer = setTimeout(() => void push(), Math.max(0, last + EVERY_MS - Date.now()));
        });
        cleanup.push(() => {
          unwatch();
          if (timer) clearTimeout(timer);
        });
      }
      status();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" } });
}
