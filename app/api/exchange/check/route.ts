import { parseAccounts } from "@/lib/tools/exchange/accounts";
import { fundingRows, rowsOf, type Balances } from "@/lib/tools/exchange/balance";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";

/* "Test" an exchange account: open the client and read the balance. A
   diagnostic, never an action; the response is always 200 with `ok`. The
   body carries the key: nothing is logged. */
export async function POST(req: Request) {
  let body: { account?: unknown };
  try {
    body = (await req.json()) as { account?: unknown };
  } catch {
    return Response.json({ ok: false, message: "Unreadable request body." }, { status: 400 });
  }
  const [account] = parseAccounts([body.account]);
  if (!account) return Response.json({ ok: false, message: "Incomplete account: exchange, label, key and secret." }, { status: 400 });
  try {
    const ex = await clientFor(account, "spot");
    const trading = rowsOf((await ex.fetchBalance()) as Balances);
    const funding = await fundingRows(ex, account.exchange);
    const count = (n: number) => `${n} asset${n > 1 ? "s" : ""}`;
    const parts = [trading.length === 0 ? "connected, no trading balance" : `connected, ${count(trading.length)} in balance`];
    if (funding && funding.length > 0) parts.push(`${count(funding.length)} in the Funding wallet (${funding.map((r) => `${r.total} ${r.asset}`).join(", ")}) — to be transferred to trading`);
    return Response.json({ ok: true, message: parts.join(" · ") });
  } catch (e) {
    return Response.json({ ok: false, message: describeExchangeError(e) });
  }
}
