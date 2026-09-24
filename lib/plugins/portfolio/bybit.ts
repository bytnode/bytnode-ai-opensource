import type { Exchange } from "ccxt";
import { fundingRows } from "@/lib/tools/exchange/balance";
import { describeExchangeError, withRetry } from "@/lib/tools/exchange/errors";
import type { Activity, Coverage, Move } from "./backfill";
import type { SavingsInputs } from "./savings";

/* ---------------------------------------------------------------------------
   Bybit's side of an account the ledger does not see: what the API key may
   read, and the savings — the Funding wallet (where deposits land) and
   Earn — for `savingsByDay`. Bybit's own v5 endpoints through ccxt's raw
   methods, read-only calls only; a window per request (Earn's interest:
   30 days) and a cursor per page. SERVER-ONLY.
--------------------------------------------------------------------------- */

const DAY = 86_400_000;
type Raw = (params: Record<string, unknown>) => Promise<{ result?: Record<string, unknown> }>;
type Row = Record<string, unknown>;

const raw = (ex: Exchange, name: string): Raw => (params) => (ex as unknown as Record<string, Raw>)[name].call(ex, params);

async function paged(call: Raw, params: Record<string, unknown>, listKey: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 40; i++) {
    const r = await withRetry(() => call({ ...params, ...(cursor ? { cursor } : {}) }));
    const list = (r.result?.[listKey] ?? []) as Row[];
    out.push(...list);
    cursor = String(r.result?.nextPageCursor ?? "") || undefined;
    if (!cursor || list.length === 0) break;
  }
  return out;
}

/** The key's permissions (group → granted list), or null when Bybit does
    not say. */
export async function bybitPermissions(ex: Exchange): Promise<Record<string, unknown> | null> {
  try {
    const r = await withRetry(() => raw(ex, "privateGetV5UserQueryApi")({}));
    return (r.result?.permissions as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

const EARN = ["FlexibleSaving", "OnChain"];

/** What Earn holds today, by coin — nothing when the key may not read it. */
export async function bybitEarn(ex: Exchange): Promise<Array<{ asset: string; amount: number }>> {
  const held: Record<string, number> = {};
  try {
    for (const category of EARN) {
      for (const p of ((await withRetry(() => raw(ex, "privateGetV5EarnPosition")({ category }))).result?.list as Row[] | undefined) ?? []) {
        const coin = String(p.coin ?? "").toUpperCase();
        const amount = Number(p.amount);
        if (coin && amount > 0) held[coin] = (held[coin] ?? 0) + amount;
      }
    }
  } catch {
    return [];
  }
  return Object.entries(held).map(([asset, amount]) => ({ asset, amount }));
}

/** The trading account's own lines that move money to or from the savings
    side: a transfer with Funding, a subscription or redemption of Earn. */
const TO_SAVINGS = /^TRANSFER_(IN|OUT)$|STAKING|EARN|SAVING|ONCHAIN/i;

const ms = (v: unknown) => {
  const n = Number(v);
  return n > 0 && n < 1e12 ? n * 1000 : n;
};

/** What `savingsByDay` needs, and how far each part was read. */
export async function bybitSavings(
  ex: Exchange,
  since: number,
  now: number,
  utaMoves: Move[],
  transfers: Activity[],
  canConvert: boolean,
): Promise<{ inputs: SavingsInputs; coverage: { earn: Coverage; converts: Coverage } }> {
  const fundNow: Record<string, number> = {};
  for (const r of (await fundingRows(ex, "bybit")) ?? []) if (r.total > 0) fundNow[r.asset] = r.total;

  const earnNow: Record<string, number> = Object.fromEntries((await bybitEarn(ex)).map((e) => [e.asset, e.amount]));
  const earnRows: SavingsInputs["earnRows"] = [];
  const events: SavingsInputs["events"] = [];
  let earn: Coverage = { status: "ok", from: new Date(since).toISOString() };
  try {
    for (const category of EARN) {
      for (let start = since; start < now; start += 30 * DAY) {
        const rows = await paged(raw(ex, "privateGetV5EarnYield"), { category, limit: 100, startTime: start, endTime: Math.min(start + 30 * DAY - 1, now) }, "list");
        for (const r of rows) {
          const t = ms(r.createdAt);
          const coin = String(r.coin ?? "").toUpperCase();
          if (!coin || !(t > 0)) continue;
          const staked = Number(r.effectiveStakingAmount);
          if (Number.isFinite(staked)) earnRows.push({ t, coin, staked });
          const paid = Number(r.amount);
          if (paid > 0) events.push({ t, coin, delta: paid });
        }
      }
    }
  } catch (e) {
    earn = { status: "error", note: describeExchangeError(e) };
  }

  let converts: Coverage = { status: "unsupported", note: "The API key does not allow the conversions' history." };
  if (canConvert) {
    try {
      for (const r of await paged(raw(ex, "privateGetV5AssetExchangeOrderRecord"), { limit: 50 }, "orderBody")) {
        const t = ms(r.createdTime);
        if (!(t >= since)) continue;
        events.push({ t, coin: String(r.fromCoin ?? "").toUpperCase(), delta: -Number(r.fromAmount) });
        events.push({ t, coin: String(r.toCoin ?? "").toUpperCase(), delta: Number(r.toAmount) });
      }
      converts = { status: "ok", from: new Date(since).toISOString() };
    } catch (e) {
      converts = { status: "error", note: describeExchangeError(e) };
    }
  }

  /* Deposits land in Funding; a withdrawal leaves it, with its fee. */
  for (const a of transfers) {
    if (a.kind === "deposit") events.push({ t: a.t, coin: a.asset, delta: a.amount });
    else if (a.kind === "withdrawal") events.push({ t: a.t, coin: a.asset, delta: -(a.amount + (a.fee ?? 0)) });
  }
  /* What the trading account received from the savings side left it. */
  for (const m of utaMoves) if (m.type && TO_SAVINGS.test(m.type)) events.push({ t: m.t, coin: m.asset, delta: -m.delta });

  return { inputs: { fundNow, earnNow, earnRows, events: events.filter((e) => e.coin && Number.isFinite(e.delta) && e.delta !== 0) }, coverage: { earn, converts } };
}
