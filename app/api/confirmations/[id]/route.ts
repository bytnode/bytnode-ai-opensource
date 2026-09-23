import { decideConfirmation } from "@/lib/plugins/core/confirmations";
import { runConfirmed } from "@/lib/plugins/core/run-confirmed";
import { readyRuntime } from "@/lib/plugins/host";
import { readTransport } from "@/lib/tools/transport";

/* ---------------------------------------------------------------------------
   The user's answer to a parked call: `{ allow: true | false }`.

   ⚠️ THE ONLY PLACE WHERE A PLUGIN'S ORDER RUNS. The browser posts here
   from the permission prompt (LIVE / TESTNET badge, no "Always"), with the
   targeted account in the usual header. Allowed, the core tool runs once;
   then the plugin is told the outcome (a DCA plan records its purchase).
--------------------------------------------------------------------------- */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { allow?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (typeof body.allow !== "boolean") return Response.json({ error: { message: "Missing decision." } }, { status: 400 });
  const { exchangeAccounts } = readTransport(req.headers);
  try {
    const decided = await decideConfirmation(id, body.allow, (c) => runConfirmed(c, exchangeAccounts, req.signal));
    await (await readyRuntime()).confirmed(decided);
    return Response.json({ confirmation: decided });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 409 });
  }
}
