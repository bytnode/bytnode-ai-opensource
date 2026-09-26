import { CASH, type Book, type Fill, type PaperOrder, type Valuation } from "./engine";

/* ---------------------------------------------------------------------------
   The paper portfolio in words: for the agent, the thread's card, the
   exported report and the prompt. Every line says SIMULATED — a paper
   result must never pass for a real performance. Pure, tested.
--------------------------------------------------------------------------- */

export const SIMULATED = "Simulated with paper money: not a real performance, no real order.";

/** A quantity or a price, without trailing noise. */
export const num = (x: number) => Number(x.toPrecision(8)).toString();
export const usdt = (x: number) => `${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, " ")} ${CASH}`;
export const signed = (x: number) => `${x >= 0 ? "+" : "−"}${usdt(Math.abs(x))}`;

export function orderLine(o: PaperOrder): string {
  const what = `${o.side} ${num(o.amount)} ${o.symbol}${o.market === "futures" ? ` (futures ×${o.leverage ?? 1}${o.reduceOnly ? ", reduce-only" : ""})` : ""}`;
  return o.type === "limit" ? `${what} limit ${num(o.price ?? 0)} [${o.id}]` : `${what} at market [${o.id}]`;
}

export function fillLine(f: Fill): string {
  const head = f.liquidation ? `LIQUIDATED ${f.symbol} at ${num(f.price)}` : `${f.side} ${num(f.amount)} ${f.symbol}${f.market === "futures" ? " (futures)" : ""} at ${num(f.price)}`;
  return `${f.at.slice(0, 16).replace("T", " ")} UTC — ${head}, fee ${usdt(f.fee)}${f.realizedPnl ? `, realized ${signed(f.realizedPnl)}` : ""}`;
}

/** Less than a cent held back: nothing to say. */
const holds = (cash: number, free: number) => cash - free >= 0.005;

/** The cash, and what the open orders hold back of it: a limit buy's
    funds are not free to trade. */
export const cashLine = (v: Pick<Valuation, "cash" | "free">) =>
  holds(v.cash, v.free) ? `Cash ${usdt(v.cash)}, of which ${usdt(v.cash - v.free)} held by open orders: ${usdt(v.free)} free to trade.` : `Cash ${usdt(v.cash)}.`;

/** The portfolio for the agent: PaperPortfolio's output. */
export function portfolioLines(book: Book, v: Valuation, at: Date): string[] {
  const lines = [`PAPER portfolio — ${at.toISOString().slice(0, 16).replace("T", " ")} UTC. ${SIMULATED}`];
  lines.push(
    v.equity === undefined
      ? `Equity: unknown, no price for ${v.missing.join(", ")}. ${cashLine(v)}`
      : `Equity ${usdt(v.equity)} for a capital of ${usdt(book.capital)} (${signed(v.equity - book.capital)}, ${v.returnPct?.toFixed(2)} %). ${cashLine(v)}`,
  );
  lines.push(`Realized ${signed(v.realized)} · fees paid ${usdt(v.fees)}${v.unrealized !== undefined ? ` · unrealized ${signed(v.unrealized)}` : ""}.`);
  if (v.holdings.length) {
    lines.push("Spot holdings:");
    for (const h of v.holdings) lines.push(`- ${h.asset} ${num(h.amount)}, average ${num(h.avgPrice)}${h.price !== undefined ? `, now ${num(h.price)} = ${usdt(h.value!)} (${signed(h.unrealized!)})` : ", no price"}`);
  }
  if (v.positions.length) {
    lines.push("Futures positions (isolated):");
    for (const p of v.positions) lines.push(`- ${p.symbol} ${p.side} ${num(p.amount)} @ ${num(p.entryPrice)} ×${p.leverage}, margin ${usdt(p.margin)}${p.mark !== undefined ? `, mark ${num(p.mark)}, PnL ${signed(p.unrealized!)}` : ""}, liquidation ${num(p.liquidation)}`);
  }
  const open = book.orders.filter((o) => o.status === "open");
  if (open.length) lines.push("Open orders:", ...open.map((o) => `- ${orderLine(o)}`));
  const recent = book.fills.slice(-5);
  if (recent.length) lines.push("Last fills:", ...recent.map((f) => `- ${fillLine(f)}`));
  return lines;
}

const bookLine = (book: Book, free?: number) => {
  const cash = book.balances[CASH] ?? 0;
  const held = free !== undefined && holds(cash, free) ? ` (${usdt(free)} free, the rest held by open orders)` : "";
  return `capital ${usdt(book.capital)}, cash ${usdt(cash)}${held}, ${book.positions.length} futures position(s), ${book.orders.filter((o) => o.status === "open").length} open order(s)`;
};

/** The prompt section: what the agent must know without a call. One
    portfolio reads as before; several are listed, the first the default. */
export function paperPrompt(books: Array<{ name: string; book: Book; free?: number }>): string {
  const [first, ...rest] = books;
  const shown = rest.slice(0, 5);
  const listing =
    rest.length === 0
      ? `A simulated portfolio (${bookLine(first.book, first.free)}). PaperOrder / PaperCancel trade it, PaperPortfolio shows it.`
      : [
          `${books.length} simulated portfolios; PaperOrder / PaperCancel / PaperPortfolio take \`portfolio\` (by name), the first is the default:`,
          `- ${first.name} (default): ${bookLine(first.book, first.free)}`,
          ...shown.map((b) => `- ${b.name}: ${bookLine(b.book, b.free)}`),
          ...(rest.length > shown.length ? [`- and ${rest.length - shown.length} more (PaperPortfolio lists them)`] : []),
        ].join("\n");
  return [
    "## Paper trading",
    listing,
    "Whenever you report a paper result, say it is simulated — never present it as a real performance. A paper order is never a real one: to trade for real, the user asks for it and PlaceOrder asks for their consent.",
  ].join("\n");
}

type Section = { heading: string; markdown: string };

/** The exported report's sections. */
export function exportSections(book: Book, v: Valuation): Section[] {
  const sections: Section[] = [
    {
      heading: "Simulated result",
      markdown: [
        `**${SIMULATED}**`,
        "",
        v.equity === undefined ? `Equity unknown: no price for ${v.missing.join(", ")}.` : `Equity **${usdt(v.equity)}** for a capital of ${usdt(book.capital)}: ${signed(v.equity - book.capital)} (${v.returnPct?.toFixed(2)} %).`,
        `Realized ${signed(v.realized)}, fees ${usdt(v.fees)}${v.unrealized !== undefined ? `, unrealized ${signed(v.unrealized)}` : ""}. Started ${book.createdAt.slice(0, 10)}.`,
      ].join("\n"),
    },
  ];
  if (v.holdings.length) {
    sections.push({
      heading: "Spot holdings",
      markdown: ["| Asset | Amount | Average | Price | Value | Result |", "|---|---:|---:|---:|---:|---:|", ...v.holdings.map((h) => `| ${h.asset} | ${num(h.amount)} | ${num(h.avgPrice)} | ${h.price !== undefined ? num(h.price) : "—"} | ${h.value !== undefined ? usdt(h.value) : "—"} | ${h.unrealized !== undefined ? signed(h.unrealized) : "—"} |`)].join("\n"),
    });
  }
  if (v.positions.length) {
    sections.push({
      heading: "Futures positions",
      markdown: ["| Pair | Side | Size | Entry | Leverage | Mark | PnL | Liquidation |", "|---|---|---:|---:|---:|---:|---:|---:|", ...v.positions.map((p) => `| ${p.symbol} | ${p.side} | ${num(p.amount)} | ${num(p.entryPrice)} | ×${p.leverage} | ${p.mark !== undefined ? num(p.mark) : "—"} | ${p.unrealized !== undefined ? signed(p.unrealized) : "—"} | ${num(p.liquidation)} |`)].join("\n"),
    });
  }
  const fills = book.fills.slice(-50);
  if (fills.length) sections.push({ heading: "Fills", markdown: fills.map((f) => `- ${fillLine(f)}`).join("\n") });
  return sections;
}
