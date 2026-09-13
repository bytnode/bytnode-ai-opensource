/* La condition d'arret d'ExchangeWatch : une grammaire minuscule, lisible
   par le modele et par l'utilisateur. Pur. */

export type Sample = {
  price: number;
  /** PnL latent de la position, si elle existe. */
  pnl?: number;
  pnlPct?: number;
  /** Distance a la liquidation en % du mark (signee). */
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
  if (!m) return { error: `Condition \`until\` illisible : « ${t} ». Attendu : \`price>=70000\`, \`pnl<-50\`, \`pnl%<-2\`, \`liq<3%\` ou \`closed\`.` };
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
