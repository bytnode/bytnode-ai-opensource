import type { Position, Ticker } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, resolve, symbolOn, type BaseArgs, type Resolved } from "./common";
import { describeExchangeError } from "./errors";
import { liquidationDistance, n8 } from "./format";
import { holds, parseUntil, type Condition, type Sample } from "./watch-until";

/* ---------------------------------------------------------------------------
   ExchangeWatch : suivre un prix ou une position, toutes les N secondes.

   Comme `Monitor` pour un processus : chaque releve est une ligne envoyee a
   l'ecran au moment ou elle sort (`tool_line`), et l'outil rend la main
   quand la condition `until` tient, quand la position se ferme, quand le
   temps est ecoule, ou quand l'utilisateur interrompt. Surveillance BORNEE :
   rien ne survit au tour ; le modele relance s'il veut continuer.
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
  description:
    "Surveille une paire (et la position futures dessus) : un relevé toutes les `every` secondes (5–300, défaut 30), affiché à l'utilisateur au fil de l'eau. " +
    "S'arrête quand `until` est vrai (`price>=70000`, `pnl<-50`, `pnl%<-2`, `liq<3%`, `closed`), quand la position se ferme, ou après `timeout` ms (défaut 300000, max 600000). Lecture seule, sans permission.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      every: { type: "integer", minimum: MIN_EVERY, maximum: MAX_EVERY, description: "Secondes entre deux relevés." },
      timeout: { type: "integer", minimum: 5000, maximum: MAX_TIMEOUT, description: "Durée maximale en millisecondes." },
      until: { type: "string", description: "Condition d'arrêt : `price>=70000`, `pnl<-50`, `pnl%<-2`, `liq<3%` ou `closed`." },
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
    const done = (why: string) => ok([...lines, `Arrêt : ${why}`].join("\n"));

    let wasOpen: boolean | undefined;
    let misses = 0;
    while (true) {
      if (ctx.signal.aborted) return done("interrompu.");
      try {
        const sample = await read(r.ex, symbol, r.market === "futures");
        misses = 0;
        push(describe(sample));
        if (wasOpen === undefined) wasOpen = sample.open;
        if (cond && holds(cond, sample)) return done(`condition \`${args.until}\` atteinte.`);
        if (wasOpen && !sample.open) return done("position fermée.");
      } catch (e) {
        misses++;
        push(`(relevé manqué : ${describeExchangeError(e)})`);
        if (misses >= MAX_MISSES) return fail([...lines, `Arrêt : ${MAX_MISSES} relevés manqués de suite.`].join("\n"));
      }
      const left = deadline - Date.now();
      if (left <= 0) return done(`temps écoulé (${Math.round(timeout / 1000)} s).`);
      const interrupted = await sleep(Math.min(every, left), ctx.signal);
      if (interrupted) return done("interrompu.");
    }
  },
};

async function read(ex: Resolved["ex"], symbol: string, futures: boolean): Promise<Sample> {
  const t = (await ex.fetchTicker(symbol)) as Ticker;
  const sample: Sample = { price: t.last ?? 0, open: false };
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
  return sample;
}

function describe(s: Sample): string {
  const parts = [new Date().toISOString().slice(11, 19), `mark ${n8(s.price)}`];
  if (s.open) {
    if (s.pnl !== undefined) parts.push(`PnL ${s.pnl >= 0 ? "+" : "−"}${n8(Math.abs(s.pnl))}${s.pnlPct !== undefined ? ` (${s.pnlPct >= 0 ? "+" : "−"}${n8(Math.abs(s.pnlPct))} %)` : ""}`);
    if (s.liqPct !== undefined) parts.push(`liquidation à ${n8(Math.abs(s.liqPct))} %`);
  }
  return parts.join(" · ");
}

/** Vrai si le signal a coupe l'attente. */
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
