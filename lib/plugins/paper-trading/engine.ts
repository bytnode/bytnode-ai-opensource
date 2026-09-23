import { baseOf } from "../shared/quote";
import { isolatedLiquidation } from "../shared/margin";

/* ---------------------------------------------------------------------------
   The paper trading engine: a simulated portfolio, never real money.

   Cash is USDT, the market's reference: spot pairs and linear perpetuals
   are quoted in it. Spot buys and sells move balances (average cost kept
   for the realized result); futures are one-way positions in ISOLATED
   margin, with a leverage, liquidated when the price crosses the
   liquidation price (the margin is lost, as on an exchange).

   A market order fills at the current price moved by the slippage against
   the trader; a limit order fills at once if the price is already there
   (taker, the same slippage, never worse than the limit), otherwise it
   waits with its funds reserved and fills AT ITS PRICE when the market
   reaches it (maker). Fees on every fill.

   Pure and deterministic: prices, times and ids come from the caller — the
   same orders at the same prices give the same result, to the cent.
   Tested.
--------------------------------------------------------------------------- */

export const CASH = "USDT";

export type PaperMarket = "spot" | "futures";
export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";

export type PaperOrder = {
  id: string;
  createdAt: string;
  symbol: string;
  market: PaperMarket;
  side: Side;
  type: OrderType;
  /** Base quantity. */
  amount: number;
  /** Limit price. */
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
  status: "open" | "filled" | "cancelled";
  closedAt?: string;
  /** Why it was cancelled, or who placed it ("DCA: weekly BTC"). */
  note?: string;
};

export type Fill = {
  id: string;
  orderId: string;
  at: string;
  symbol: string;
  market: PaperMarket;
  side: Side;
  amount: number;
  price: number;
  fee: number;
  /** Gross of fees: what a sale or a closing brought against the cost. */
  realizedPnl: number;
  liquidation?: boolean;
};

export type Position = {
  symbol: string;
  side: "long" | "short";
  amount: number;
  entryPrice: number;
  leverage: number;
  /** The isolated margin set aside. */
  margin: number;
  openedAt: string;
};

export type Book = {
  version: 1;
  capital: number;
  createdAt: string;
  /** Spot balances, cash included. */
  balances: Record<string, number>;
  /** The cost of each spot holding (without fees), for its average price. */
  costs: Record<string, number>;
  positions: Position[];
  /** The open orders and the last closed ones. */
  orders: PaperOrder[];
  fills: Fill[];
  realizedPnl: number;
  fees: number;
};

export type EngineConfig = {
  /** Per fill, as a fraction: 0.001 = 0.1 %. */
  feeRate: number;
  /** Against the trader, as a fraction. */
  slippage: number;
  /** Maintenance margin rate of the futures. */
  mmr: number;
};

export type OrderInput = {
  symbol: string;
  market: PaperMarket;
  side: Side;
  type: OrderType;
  amount?: number;
  quoteAmount?: number;
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
  note?: string;
};

export type Ids = () => string;

const KEEP_CLOSED = 200;
const KEEP_FILLS = 1000;
const MIN_NOTIONAL = 1;
const DUST = 1e-9;

export function emptyBook(capital: number, now: Date): Book {
  return { version: 1, capital, createdAt: now.toISOString(), balances: { [CASH]: capital }, costs: {}, positions: [], orders: [], fills: [], realizedPnl: 0, fees: 0 };
}

const quoteOf = (symbol: string) => symbol.split("/")[1]?.split(":")[0] ?? "";

/** What an open order holds back: cash for a buy (spot) or a margin
    (futures), the asset for a spot sell. */
function reservation(o: PaperOrder, cfg: EngineConfig): { asset: string; amount: number } | null {
  if (o.status !== "open" || o.price === undefined) return null;
  const notional = o.amount * o.price;
  if (o.market === "spot") return o.side === "buy" ? { asset: CASH, amount: notional * (1 + cfg.feeRate) } : { asset: baseOf(o.symbol), amount: o.amount };
  return o.reduceOnly ? null : { asset: CASH, amount: notional / (o.leverage ?? 1) + notional * cfg.feeRate };
}

/** A balance minus what the open orders (but `except`) hold back. */
export function available(book: Book, asset: string, cfg: EngineConfig, except?: string): number {
  let held = 0;
  for (const o of book.orders) {
    if (o.id === except) continue;
    const r = reservation(o, cfg);
    if (r?.asset === asset) held += r.amount;
  }
  return (book.balances[asset] ?? 0) - held;
}

const add = (map: Record<string, number>, key: string, delta: number) => {
  const v = (map[key] ?? 0) + delta;
  if (Math.abs(v) < DUST) delete map[key];
  else map[key] = v;
};

const money = (n: number) => n.toFixed(2);

const trimmed = (book: Book): Book => {
  const open = book.orders.filter((o) => o.status === "open");
  const closed = book.orders.filter((o) => o.status !== "open").slice(-KEEP_CLOSED);
  return { ...book, orders: [...closed, ...open].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), fills: book.fills.slice(-KEEP_FILLS) };
};

type Executed = { book: Book; fill: Fill } | { error: string };

/** Fills `order` at `price`: the book after, or why it cannot. */
function execute(book: Book, order: PaperOrder, price: number, cfg: EngineConfig, fillId: string, now: Date): Executed {
  const b: Book = { ...book, balances: { ...book.balances }, costs: { ...book.costs }, positions: book.positions.map((p) => ({ ...p })) };
  const base = baseOf(order.symbol);
  let amount = order.amount;
  let fee = 0;
  let realized = 0;

  if (order.market === "spot") {
    const notional = amount * price;
    fee = notional * cfg.feeRate;
    if (order.side === "buy") {
      const free = available(book, CASH, cfg, order.id);
      if (free < notional + fee) return { error: `Not enough ${CASH} in the paper portfolio: ${money(notional + fee)} needed, ${money(free)} available.` };
      add(b.balances, CASH, -(notional + fee));
      add(b.balances, base, amount);
      add(b.costs, base, notional);
    } else {
      const free = available(book, base, cfg, order.id);
      if (free < amount - DUST) return { error: `Not enough ${base} in the paper portfolio: ${amount} to sell, ${free} available.` };
      const held = book.balances[base] ?? 0;
      const cost = held > 0 ? ((book.costs[base] ?? 0) * amount) / held : 0;
      realized = notional - cost;
      add(b.balances, CASH, notional - fee);
      add(b.balances, base, -amount);
      add(b.costs, base, -cost);
      if (!b.balances[base]) delete b.costs[base];
    }
  } else {
    const dir = order.side === "buy" ? "long" : "short";
    const i = b.positions.findIndex((p) => p.symbol === order.symbol);
    const pos = i >= 0 ? b.positions[i] : undefined;
    let rest = amount;
    if (pos && pos.side !== dir) {
      const qty = Math.min(rest, pos.amount);
      const pnl = (price - pos.entryPrice) * qty * (pos.side === "long" ? 1 : -1);
      const released = (pos.margin * qty) / pos.amount;
      const closeFee = qty * price * cfg.feeRate;
      add(b.balances, CASH, released + pnl - closeFee);
      realized += pnl;
      fee += closeFee;
      pos.amount -= qty;
      pos.margin -= released;
      if (pos.amount < DUST) b.positions.splice(i, 1);
      rest -= qty;
      if (order.reduceOnly) amount = qty;
    } else if (order.reduceOnly) {
      return { error: `Reduce-only: there is no ${dir === "long" ? "short" : "long"} ${order.symbol} position to reduce.` };
    }
    if (rest > DUST && !order.reduceOnly) {
      const same = b.positions.find((p) => p.symbol === order.symbol);
      if (same && order.leverage !== undefined && order.leverage !== same.leverage) {
        return { error: `The ${order.symbol} position is at ×${same.leverage}: close it before changing the leverage.` };
      }
      const leverage = same?.leverage ?? order.leverage ?? 1;
      const notional = rest * price;
      const margin = notional / leverage;
      const openFee = notional * cfg.feeRate;
      const free = available(book, CASH, cfg, order.id) + ((b.balances[CASH] ?? 0) - (book.balances[CASH] ?? 0));
      if (free < margin + openFee) return { error: `Not enough ${CASH} for the margin: ${money(margin + openFee)} needed (×${leverage}), ${money(free)} available.` };
      add(b.balances, CASH, -(margin + openFee));
      fee += openFee;
      if (same) {
        same.entryPrice = (same.entryPrice * same.amount + price * rest) / (same.amount + rest);
        same.amount += rest;
        same.margin += margin;
      } else {
        b.positions.push({ symbol: order.symbol, side: dir, amount: rest, entryPrice: price, leverage, margin, openedAt: now.toISOString() });
      }
    }
  }

  const fill: Fill = { id: fillId, orderId: order.id, at: now.toISOString(), symbol: order.symbol, market: order.market, side: order.side, amount, price, fee, realizedPnl: realized };
  b.fees += fee;
  b.realizedPnl += realized;
  b.fills = [...b.fills, fill];
  b.orders = [...book.orders.filter((o) => o.id !== order.id), { ...order, amount, status: "filled", closedAt: now.toISOString() }];
  return { book: trimmed(b), fill };
}

export type Placed = { book: Book; order: PaperOrder; fill?: Fill } | { error: string };

/** Places an order at the current price `px`: filled at once, or left open
    (a limit the market has not reached). */
export function placeOrder(book: Book, input: OrderInput, px: number, cfg: EngineConfig, ids: Ids, now: Date): Placed {
  if (quoteOf(input.symbol) !== CASH) return { error: `The paper portfolio trades against ${CASH}: use ${baseOf(input.symbol)}/${CASH}.` };
  if (!(px > 0)) return { error: `No valid price for ${input.symbol}.` };
  if (input.type === "limit" && !(input.price !== undefined && input.price > 0)) return { error: "A limit order requires `price`." };
  if (input.market === "spot" && (input.leverage !== undefined || input.reduceOnly)) return { error: "Leverage and reduce-only are for futures (`market: futures`)." };
  if (input.leverage !== undefined && !(Number.isInteger(input.leverage) && input.leverage >= 1 && input.leverage <= 125)) return { error: "Leverage: a whole number between 1 and 125." };
  if ((input.amount === undefined) === (input.quoteAmount === undefined)) return { error: `Give \`amount\` (in ${baseOf(input.symbol)}) or \`quoteAmount\` (in ${CASH}), not both.` };

  const marketable = input.type === "market" || (input.side === "buy" ? px <= input.price! : px >= input.price!);
  const slipped = input.side === "buy" ? px * (1 + cfg.slippage) : px * (1 - cfg.slippage);
  const fillPrice = input.type === "market" ? slipped : input.side === "buy" ? Math.min(input.price!, slipped) : Math.max(input.price!, slipped);
  const sizing = input.type === "limit" && !marketable ? input.price! : fillPrice;
  const amount = input.amount ?? input.quoteAmount! / sizing;
  if (!(amount > 0)) return { error: "The quantity must be positive." };
  if (amount * sizing < MIN_NOTIONAL) return { error: `Below the minimum: an order of at least ${MIN_NOTIONAL} ${CASH}.` };

  const order: PaperOrder = {
    id: ids(),
    createdAt: now.toISOString(),
    symbol: input.symbol,
    market: input.market,
    side: input.side,
    type: input.type,
    amount,
    ...(input.type === "limit" ? { price: input.price } : {}),
    ...(input.market === "futures" ? { leverage: input.leverage ?? book.positions.find((p) => p.symbol === input.symbol)?.leverage ?? 1 } : {}),
    ...(input.reduceOnly ? { reduceOnly: true } : {}),
    status: "open",
    ...(input.note ? { note: input.note } : {}),
  };
  if (marketable) {
    const r = execute(book, order, fillPrice, cfg, ids(), now);
    return "error" in r ? r : { book: r.book, order: r.book.orders.find((o) => o.id === order.id)!, fill: r.fill };
  }
  const held = reservation(order, cfg);
  if (held) {
    const free = available(book, held.asset, cfg);
    if (free < held.amount - DUST) return { error: `Not enough ${held.asset} to hold for this order: ${held.asset === CASH ? money(held.amount) : held.amount} needed, ${held.asset === CASH ? money(free) : free} available.` };
  }
  return { book: trimmed({ ...book, orders: [...book.orders, order] }), order };
}

/** Cancels an open order (`all`: every one). */
export function cancelOrders(book: Book, id: string, now: Date, note = "cancelled"): { book: Book; cancelled: PaperOrder[] } | { error: string } {
  const targets = book.orders.filter((o) => o.status === "open" && (id === "all" || o.id === id));
  if (targets.length === 0) return { error: id === "all" ? "No open paper order." : `No open paper order ${id}.` };
  const ids = new Set(targets.map((o) => o.id));
  const orders = book.orders.map((o) => (ids.has(o.id) ? { ...o, status: "cancelled" as const, closedAt: now.toISOString(), note } : o));
  return { book: trimmed({ ...book, orders }), cancelled: targets };
}

export type CheckEvent = { kind: "filled"; order: PaperOrder; fill: Fill } | { kind: "cancelled"; order: PaperOrder; reason: string } | { kind: "liquidated"; position: Position; fill: Fill };

/** One look at the market: the open limits it reached fill at their
    price, the positions it crossed are liquidated. */
export function checkBook(book: Book, prices: Map<string, number>, cfg: EngineConfig, ids: Ids, now: Date): { book: Book; events: CheckEvent[] } {
  let b = book;
  const events: CheckEvent[] = [];
  for (const o of book.orders) {
    const px = prices.get(o.symbol);
    if (o.status !== "open" || o.price === undefined || px === undefined) continue;
    if (o.side === "buy" ? px > o.price : px < o.price) continue;
    const r = execute(b, o, o.price, cfg, ids(), now);
    if ("error" in r) {
      const c = cancelOrders(b, o.id, now, r.error);
      if (!("error" in c)) b = c.book;
      events.push({ kind: "cancelled", order: o, reason: r.error });
    } else {
      b = r.book;
      events.push({ kind: "filled", order: o, fill: r.fill });
    }
  }
  for (const p of b.positions) {
    const px = prices.get(p.symbol);
    const liq = liquidationPrice(p, cfg);
    if (px === undefined || (p.side === "long" ? px > liq : px < liq)) continue;
    /* The isolated margin is lost: nothing comes back to the cash. */
    const fill: Fill = { id: ids(), orderId: "liquidation", at: now.toISOString(), symbol: p.symbol, market: "futures", side: p.side === "long" ? "sell" : "buy", amount: p.amount, price: liq, fee: 0, realizedPnl: -p.margin, liquidation: true };
    b = trimmed({ ...b, positions: b.positions.filter((x) => x !== p), fills: [...b.fills, fill], realizedPnl: b.realizedPnl - p.margin });
    events.push({ kind: "liquidated", position: p, fill });
  }
  return { book: b, events };
}

export const liquidationPrice = (p: Position, cfg: EngineConfig): number => isolatedLiquidation(p.side, p.entryPrice, p.leverage, cfg.mmr);

/** The symbols whose price the book needs: holdings, positions, open orders. */
export function neededSymbols(book: Book): string[] {
  const s = new Set<string>();
  for (const asset of Object.keys(book.balances)) if (asset !== CASH) s.add(`${asset}/${CASH}`);
  for (const p of book.positions) s.add(p.symbol);
  for (const o of book.orders) if (o.status === "open") s.add(o.symbol);
  return [...s];
}

export type Valuation = {
  cash: number;
  holdings: Array<{ asset: string; amount: number; avgPrice: number; price?: number; value?: number; unrealized?: number }>;
  positions: Array<Position & { mark?: number; unrealized?: number; liquidation: number }>;
  /** Undefined when a price is missing: never a partial total shown as whole. */
  equity?: number;
  unrealized?: number;
  missing: string[];
  realized: number;
  fees: number;
  returnPct?: number;
};

/** The book at the given prices. */
export function valuation(book: Book, prices: Map<string, number>, cfg: EngineConfig): Valuation {
  const missing: string[] = [];
  const holdings = Object.entries(book.balances)
    .filter(([asset]) => asset !== CASH)
    .map(([asset, amount]) => {
      const price = prices.get(`${asset}/${CASH}`);
      if (price === undefined) missing.push(`${asset}/${CASH}`);
      const cost = book.costs[asset] ?? 0;
      return { asset, amount, avgPrice: amount > 0 ? cost / amount : 0, ...(price !== undefined ? { price, value: amount * price, unrealized: amount * price - cost } : {}) };
    });
  const positions = book.positions.map((p) => {
    const mark = prices.get(p.symbol);
    if (mark === undefined) missing.push(p.symbol);
    return { ...p, liquidation: liquidationPrice(p, cfg), ...(mark !== undefined ? { mark, unrealized: (mark - p.entryPrice) * p.amount * (p.side === "long" ? 1 : -1) } : {}) };
  });
  const cash = book.balances[CASH] ?? 0;
  const complete = missing.length === 0;
  const unrealized = complete ? holdings.reduce((t, h) => t + (h.unrealized ?? 0), 0) + positions.reduce((t, p) => t + (p.unrealized ?? 0), 0) : undefined;
  const equity = complete ? cash + holdings.reduce((t, h) => t + (h.value ?? 0), 0) + positions.reduce((t, p) => t + p.margin + (p.unrealized ?? 0), 0) : undefined;
  return {
    cash,
    holdings,
    positions,
    equity,
    unrealized,
    missing,
    realized: book.realizedPnl,
    fees: book.fees,
    ...(equity !== undefined && book.capital > 0 ? { returnPct: ((equity - book.capital) / book.capital) * 100 } : {}),
  };
}
