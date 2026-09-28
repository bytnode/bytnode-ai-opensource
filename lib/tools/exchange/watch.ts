import type { Position, Ticker } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, resolve, symbolOn, type BaseArgs, type Resolved } from "./common";
import { describeExchangeError } from "./errors";
import { liquidationDistance, n8 } from "./format";
import { holds, parseUntil, type Condition, type Sample } from "./watch-until";

/* ---------------------------------------------------------------------------
   ExchangeWatch: follow a price or a position, every N seconds.

   Like `Monitor` for a process: each reading is a line sent to the screen
   the moment it comes out (`tool_line`), and the tool hands back control
   when the `until` condition holds, when the position closes, when the
   time has elapsed, or when the user interrupts. BOUNDED watch: nothing
   survives the turn; the model runs it again if it wants to continue.
--------------------------------------------------------------------------- */

type Args = BaseArgs & { symbol: string; every?: number; timeout?: number; until?: string };

const MIN_EVERY = 5;
const MAX_EVERY = 300;
const DEFAULT_TIMEOUT = 300_000;
const MAX_TIMEOUT = 600_000;
const MAX_LINES = 200;
const MAX_MISSES = 3;

export const watchTool: Tool<Args> = {
  name: "ExchangeWatch",
  policy: { readOnly: true, subagent: true },
  description:
    "Watches a pair (and the futures position on it): one reading every `every` seconds (5–300, default 30), shown to the user as it comes. " +
    "Stops when `until` is true (`price>=70000`, `pnl<-50`, `pnl%<-2`, `liq<3%`, `closed`), when the position closes, or after `timeout` ms (default 300000, max 600000). Read-only, no permission needed.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      every: { type: "integer", minimum: MIN_EVERY, maximum: MAX_EVERY, description: "Seconds between two readings." },
      timeout: { type: "integer", minimum: 5000, maximum: MAX_TIMEOUT, description: "Maximum duration in milliseconds." },
      until: { type: "string", description: "Stop condition: `price>=70000`, `pnl<-50`, `pnl%<-2`, `liq<3%` or `closed`." },
      account: ACCOUNT_PROP,
      market: MARKET_PROP,
    },
    required: ["symbol"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let cond: Condition | undefined;
    if (args.until) {
      const parsed = parseUntil(args.until);
      if ("error" in parsed) return fail(parsed.error);
      cond = parsed;
    }
    const r = await resolve(args, ctx);
    if ("error" in r) return fail(r.error);
    const s = symbolOn(r.ex, args.symbol, r.market);
    if ("error" in s) return fail(s.error);
    const symbol = s.symbol;
    const every = Math.min(MAX_EVERY, Math.max(MIN_EVERY, args.every ?? 30)) * 1000;
    const timeout = Math.min(MAX_TIMEOUT, Math.max(5000, args.timeout ?? DEFAULT_TIMEOUT));
    const deadline = Date.now() + timeout;

    const lines: string[] = [];
    const push = (line: string) => {
      if (lines.length < MAX_LINES) lines.push(line);
      ctx.emit({ type: "tool_line", id: ctx.callId, line });
    };
    const done = (why: string) => ok([...lines, `Stopped: ${why}`].join("\n"));

    let wasOpen: boolean | undefined;
    let misses = 0;
    while (true) {
      if (ctx.signal.aborted) return done("interrupted.");
      try {
        const sample = await read(r.ex, symbol, r.market === "futures");
        /* ⚠️ No price is a missed reading, never a price of 0: `price<60000`
           fired on a ticker that simply carried no `last`. */
        if (sample === undefined) throw new NoPrice();
        misses = 0;
        push(describe(sample));
        if (wasOpen === undefined) wasOpen = sample.open;
        if (cond && holds(cond, sample)) return done(`condition \`${args.until}\` reached.`);
        if (wasOpen && !sample.open) return done("position closed.");
      } catch (e) {
        misses++;
        push(`(reading missed: ${e instanceof NoPrice ? e.message : describeExchangeError(e)})`);
        if (misses >= MAX_MISSES) return fail([...lines, `Stopped: ${MAX_MISSES} readings missed in a row.`].join("\n"));
      }
      const left = deadline - Date.now();
      if (left <= 0) return done(`time elapsed (${Math.round(timeout / 1000)} s).`);
      const interrupted = await sleep(Math.min(every, left), ctx.signal);
      if (interrupted) return done("interrupted.");
    }
  },
};

class NoPrice extends Error {
  constructor() {
    super("the ticker carries no price");
  }
}

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** The ticker's price: `last`, else the bid/ask midpoint, else `close`. */
export function tickerPrice(t: Pick<Ticker, "last" | "bid" | "ask" | "close">): number | undefined {
  if (num(t.last)) return t.last;
  if (num(t.bid) && num(t.ask)) return (t.bid + t.ask) / 2;
  if (num(t.close)) return t.close;
  return undefined;
}

/** One reading, or `undefined` when neither the ticker nor the position
    gives a price. */
async function read(ex: Resolved["ex"], symbol: string, futures: boolean): Promise<Sample | undefined> {
  const t = (await ex.fetchTicker(symbol)) as Ticker;
  const price = tickerPrice(t);
  const sample: Sample = { price: price ?? NaN, open: false };
  if (futures && ex.has["fetchPositions"]) {
    const positions = (await ex.fetchPositions([symbol])) as Position[];
    const p = positions.find((x) => x.symbol === symbol && (x.contracts ?? 0) > 0);
    if (p) {
      sample.open = true;
      sample.pnl = p.unrealizedPnl ?? undefined;
      sample.pnlPct = p.percentage ?? undefined;
      sample.liqPct = liquidationDistance(p);
      if (p.markPrice) sample.price = p.markPrice;
    }
  }
  return Number.isNaN(sample.price) ? undefined : sample;
}

function describe(s: Sample): string {
  const parts = [new Date().toISOString().slice(11, 19), `mark ${n8(s.price)}`];
  if (s.open) {
    if (s.pnl !== undefined) parts.push(`PnL ${s.pnl >= 0 ? "+" : "−"}${n8(Math.abs(s.pnl))}${s.pnlPct !== undefined ? ` (${s.pnlPct >= 0 ? "+" : "−"}${n8(Math.abs(s.pnlPct))} %)` : ""}`);
    if (s.liqPct !== undefined) parts.push(`liquidation at ${n8(Math.abs(s.liqPct))} %`);
  }
  return parts.join(" · ");
}

/** True if the signal cut the wait short. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(true);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
