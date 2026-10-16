import { randomBytes } from "node:crypto";
import { accountUrls } from "./flow";
import { startSignIn, type SignInOutcome } from "./sign-in";

/* ---------------------------------------------------------------------------
   The sign-ins in progress on the app's server, for the app in a browser
   (`app/api/account/sign-in`). The page starts one, opens the address it
   gets in a tab, then asks for the outcome until it is there. Kept on
   `globalThis`: `next dev` reloads route modules, a sign-in must outlive it.
--------------------------------------------------------------------------- */

type Run = { cancel: () => void; outcome: SignInOutcome | null; settled: Promise<SignInOutcome>; at: number };

/** A settled outcome waits this long for its page to read it. */
const KEEP_MS = 5 * 60_000;
/** More at once than this: the oldest goes (a page clicking again and again). */
const MAX_RUNS = 4;

const slot = Symbol.for("bytnode-ai.account.runs");
const runs = (): Map<string, Run> => {
  const g = globalThis as unknown as Record<symbol, Map<string, Run> | undefined>;
  return (g[slot] ??= new Map());
};

function sweep(now: number): void {
  const all = runs();
  for (const [id, r] of all) if (r.outcome && now - r.at > KEEP_MS) all.delete(id);
  while (all.size >= MAX_RUNS) {
    const [oldest] = all.keys();
    all.get(oldest)?.cancel();
    all.delete(oldest);
  }
}

/** Starts a sign-in; resolves with the bytnode.com address to open, or the
    failure if the app could not even wait for the browser. */
export async function beginRun(): Promise<{ ok: true; id: string; url: string } | { ok: false; message: string }> {
  sweep(Date.now());
  const id = randomBytes(18).toString("base64url");
  let gotUrl: (url: string) => void = () => {};
  const url = new Promise<string>((resolve) => (gotUrl = resolve));
  const { result, cancel } = startSignIn(accountUrls(process.env), (u) => gotUrl(u));
  const run: Run = { cancel, outcome: null, settled: result, at: Date.now() };
  runs().set(id, run);
  void result.then((o) => {
    run.outcome = o;
    run.at = Date.now();
  });
  const first = await Promise.race([url.then((u) => ({ url: u })), result.then((o) => ({ outcome: o }))]);
  if ("url" in first) return { ok: true, id, url: first.url };
  runs().delete(id);
  return { ok: false, message: first.outcome.ok ? "The sign-in ended before it began." : first.outcome.message };
}

/** The outcome of a sign-in, waiting at most `waitMs` for it; `null` while
    the browser has not come back. An unknown id reads as cancelled. */
export async function readRun(id: string, waitMs: number): Promise<SignInOutcome | null> {
  const run = runs().get(id);
  if (!run) return { ok: false, cancelled: true, message: "" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = run.outcome ?? (await Promise.race([run.settled, new Promise<null>((r) => (timer = setTimeout(() => r(null), waitMs)))]));
  clearTimeout(timer);
  if (outcome) runs().delete(id);
  return outcome;
}

export function cancelRun(id: string): void {
  runs().get(id)?.cancel();
  runs().delete(id);
}
