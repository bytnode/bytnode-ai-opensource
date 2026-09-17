import { parseAccounts } from "@/lib/tools/exchange/accounts";
import { fundingRows, rowsOf, type Balances } from "@/lib/tools/exchange/balance";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";

/* « Tester » un compte exchange : ouvrir le client et lire le solde. Un
   diagnostic, jamais une action ; la reponse est toujours 200 avec `ok`.
   Le corps porte la cle : rien n'est journalise. */
export async function POST(req: Request) {
  let body: { account?: unknown };
  try {
    body = (await req.json()) as { account?: unknown };
  } catch {
    return Response.json({ ok: false, message: "Corps de requête illisible." }, { status: 400 });
  }
  const [account] = parseAccounts([body.account]);
  if (!account) return Response.json({ ok: false, message: "Compte incomplet : exchange, label, clé et secret." }, { status: 400 });
  try {
    const ex = await clientFor(account, "spot");
    const trading = rowsOf((await ex.fetchBalance()) as Balances);
    const funding = await fundingRows(ex, account.exchange);
    const count = (n: number) => `${n} actif${n > 1 ? "s" : ""}`;
    const parts = [trading.length === 0 ? "connecté, aucun solde de trading" : `connecté, ${count(trading.length)} en solde`];
    if (funding && funding.length > 0) parts.push(`${count(funding.length)} dans le portefeuille Funding (${funding.map((r) => `${r.total} ${r.asset}`).join(", ")}) — à transférer vers le trading`);
    return Response.json({ ok: true, message: parts.join(" · ") });
  } catch (e) {
    return Response.json({ ok: false, message: describeExchangeError(e) });
  }
}
