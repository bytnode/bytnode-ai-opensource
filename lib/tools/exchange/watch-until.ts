/* ExchangeWatch's stop condition: a tiny grammar, readable by the model
   and by the user. Pure. */

export type Sample = {
  price: number;
  /** Unrealized PnL of the position, if it exists. */
  pnl?: number;
  pnlPct?: number;
  /** Distance to liquidation in % of the mark (signed). */
  liqPct?: number;
  open: boolean;
};

type Op = "<" | "<=" | ">" | ">=";
export type Condition = { field: "price" | "pnl" | "pnlPct" | "liqPct"; op: Op; value: number } | { field: "closed" };

const FIELDS: Record<string, Condition["field"]> = { price: "price", pnl: "pnl", "pnl%": "pnlPct", liq: "liqPct" };
const GRAMMAR = /^(price|pnl%|pnl|liq)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*%?$/i;

export function parseUntil(text: string): Condition | { error: string } {
  const t = text.trim();
  if (/^closed$/i.test(t)) return { field: "closed" };
  const m = GRAMMAR.exec(t);
  if (!m) return { error: `Unreadable \`until\` condition: "${t}". Expected: \`price>=70000\`, \`pnl<-50\`, \`pnl%<-2\`, \`liq<3%\` or \`closed\`.` };
  const field = FIELDS[m[1].toLowerCase()];
  if (field === "closed") return { error: "impossible" };
  return { field, op: m[2] as Op, value: Number(m[3]) };
}

const compare = (a: number, op: Op, b: number) => (op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);

export function holds(c: Condition, s: Sample): boolean {
  if (c.field === "closed") return !s.open;
  const v = c.field === "liqPct" ? (s.liqPct === undefined ? undefined : Math.abs(s.liqPct)) : s[c.field];
  return typeof v === "number" && compare(v, c.op, c.value);
}
