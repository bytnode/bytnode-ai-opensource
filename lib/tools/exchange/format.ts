import type { FundingRate, Order, OrderBook, Position, Ticker } from "ccxt";

/* Ce que le modele lit : une ligne par chose, des nombres courts, jamais
   le JSON brut de l'exchange (qui peserait dix fois plus). Pur. */

/** Jusqu'a 8 chiffres significatifs, sans zeros de fin. */
export const n8 = (n: number | undefined | null): string =>
  typeof n === "number" && Number.isFinite(n) ? Number(n.toPrecision(8)).toString() : "–";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${n8(Math.abs(n))}`;
const pct = (n: number | undefined | null) => (typeof n === "number" ? `${signed(n)} %` : "–");
const iso = (ts: number | undefined | null) => (ts ? new Date(ts).toISOString().replace(".000Z", "Z") : "–");

export type BalanceRow = { asset: string; free: number; used: number; total: number; usd?: number };

export function formatBalance(label: string, market: string, rows: BalanceRow[]): string {
  const head = `${label} · ${market}`;
  if (rows.length === 0) return `${head}\nAucun solde.`;
  const lines = rows.map((r) => {
    const parts = [`libre ${n8(r.free)}`];
    if (r.used > 0) parts.push(`bloqué ${n8(r.used)}`);
    return `${r.asset} : ${n8(r.total)} (${parts.join(", ")})${r.usd !== undefined ? ` ≈ ${n8(r.usd)} USD` : ""}`;
  });
  const priced = rows.filter((r) => r.usd !== undefined);
  const total = priced.reduce((s, r) => s + (r.usd ?? 0), 0);
  const note = priced.length < rows.length ? " (hors actifs sans prix)" : "";
  return [head, ...lines, `Total ≈ ${n8(total)} USD${note}`].join("\n");
}

/** La taille d'une position en actif de base. */
export const positionSize = (p: Position): number => (p.contracts ?? 0) * (p.contractSize ?? 1);

/** La distance a la liquidation, en % du mark (negative sous le mark). */
export const liquidationDistance = (p: Position): number | undefined =>
  p.liquidationPrice && p.markPrice ? Number((((p.liquidationPrice - p.markPrice) / p.markPrice) * 100).toFixed(2)) : undefined;

export function formatPositions(positions: Position[]): string {
  const open = positions.filter((p) => (p.contracts ?? 0) > 0);
  if (open.length === 0) return "Aucune position ouverte.";
  return open
    .map((p) => {
      const parts = [`${p.symbol} · ${(p.side ?? "?").toUpperCase()} ${n8(positionSize(p))}`, `entrée ${n8(p.entryPrice)}`, `mark ${n8(p.markPrice)}`];
      if (typeof p.unrealizedPnl === "number") parts.push(`PnL ${signed(p.unrealizedPnl)} (${pct(p.percentage)})`);
      if (p.leverage) parts.push(`×${n8(p.leverage)}${p.marginMode ? ` ${p.marginMode}` : ""}`);
      const dist = liquidationDistance(p);
      if (dist !== undefined) parts.push(`liquidation ${n8(p.liquidationPrice)} (${signed(dist)} %)`);
      return parts.join(" · ");
    })
    .join("\n");
}

export function formatOrders(orders: Order[]): string {
  if (orders.length === 0) return "Aucun ordre.";
  return orders
    .map((o) => {
      const parts = [iso(o.timestamp), `#${o.id}`, o.symbol, `${(o.side ?? "?").toUpperCase()} ${o.type} ${n8(o.amount)}${o.price ? ` @ ${n8(o.price)}` : ""}`];
      if (o.filled) parts.push(`rempli ${n8(o.filled)}${o.average ? ` (moy. ${n8(o.average)})` : ""}`);
      parts.push(String(o.status ?? "?"));
      if (o.fee?.cost) parts.push(`frais ${n8(o.fee.cost)} ${o.fee.currency ?? ""}`.trim());
      return parts.join(" · ");
    })
    .join("\n");
}

export function formatTicker(t: Ticker, book?: OrderBook, funding?: FundingRate): string {
  const lines = [`${t.symbol} · last ${n8(t.last)} · bid ${n8(t.bid)} / ask ${n8(t.ask)} · 24 h ${pct(t.percentage)} · volume ${n8(t.baseVolume)}`];
  if (funding && typeof funding.fundingRate === "number") {
    lines.push(`Funding ${n8(funding.fundingRate * 100)} % · prochain ${iso(funding.fundingTimestamp ?? funding.nextFundingTimestamp)}`);
  }
  if (book) {
    lines.push("Carnet :");
    for (const [p, a] of [...book.asks].reverse()) lines.push(`  ask ${n8(p)} × ${n8(a)}`);
    for (const [p, a] of book.bids) lines.push(`  bid ${n8(p)} × ${n8(a)}`);
  }
  return lines.join("\n");
}
