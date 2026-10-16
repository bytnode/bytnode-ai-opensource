import { beginRun, cancelRun, readRun } from "@/lib/account/server-runs";

/* The BytNode account's sign-in, for the app in a browser (the desktop app
   does it in its main process): POST starts one and gives the bytnode.com
   address the page opens in a tab; GET ?id= waits for the browser to come
   back (25 s at most, the page asks again); DELETE ?id= cancels it.
   `lib/account/browser.ts` is the page's side. */

const WAIT_MS = 25_000;

const idOf = (req: Request) => new URL(req.url).searchParams.get("id") ?? "";

export async function POST() {
  const r = await beginRun();
  if (!r.ok) return Response.json({ ok: false, cancelled: false, message: r.message }, { status: 502 });
  return Response.json({ id: r.id, url: r.url });
}

export async function GET(req: Request) {
  const outcome = await readRun(idOf(req), WAIT_MS);
  if (!outcome) return Response.json({ pending: true });
  return Response.json(outcome, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: Request) {
  cancelRun(idOf(req));
  return new Response(null, { status: 204 });
}
