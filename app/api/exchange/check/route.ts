import { parseAccounts } from "@/lib/tools/exchange/accounts";
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
    const balance = (await ex.fetchBalance()) as { total?: Record<string, number> };
    const n = Object.values(balance.total ?? {}).filter((v) => typeof v === "number" && v > 0).length;
    return Response.json({ ok: true, message: n === 0 ? "connecté, aucun solde" : `${n} actif${n > 1 ? "s" : ""} en solde` });
  } catch (e) {
    return Response.json({ ok: false, message: describeExchangeError(e) });
  }
}
