import type { Position } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";
import { liquidationDistance } from "@/lib/tools/exchange/format";
import { toSymbol } from "@/lib/tools/exchange/symbols";
import type { CalendarService } from "../calendar/service";
import { fundingRate, isQuote, quotes } from "../shared/prices";
import { baseOf } from "../shared/quote";
import { onPosition, type AlertCondition, type Reading } from "./conditions";

/* ---------------------------------------------------------------------------
   One reading of the market for every alert at once, grouped by asset: one
   price per pair (BytNode, else an exchange), one funding rate per pair
   that needs it, one positions read per account, one calendar query per
   asset. What cannot be read is said per part. SERVER-ONLY.
--------------------------------------------------------------------------- */

export type Want = { symbol: string; condition: AlertCondition; accountId?: string };

export type Sources = { bytnodeKey: string; accounts: ExchangeAccount[]; signal: AbortSignal };

const NOTABLE = 2;

export async function readAll(wants: Want[], sources: Sources, calendar: CalendarService | undefined): Promise<(symbol: string, accountId?: string) => Reading> {
  const symbols = [...new Set(wants.map((w) => w.symbol))];
  const priced = await quotes(symbols, { bytnodeKey: sources.bytnodeKey, accounts: sources.accounts, signal: sources.signal });

  const funding = new Map<string, number | undefined>();
  for (const s of new Set(wants.filter((w) => w.condition.kind === "funding").map((w) => w.symbol))) {
    funding.set(s, await fundingRate(s, { bytnodeKey: sources.bytnodeKey, accounts: sources.accounts, signal: sources.signal }));
  }

  const events = new Map<string, Array<{ title: string; startsAt: string }>>();
  const windows = new Map<string, number>();
  for (const w of wants) if (w.condition.kind === "event") windows.set(w.symbol, Math.max(windows.get(w.symbol) ?? 0, w.condition.hours));
  if (calendar) {
    for (const [s, hours] of windows) {
      events.set(s, (await calendar.upcoming({ assets: [baseOf(s)], withinHours: hours, minImportance: NOTABLE })).map((e) => ({ title: e.title, startsAt: e.startsAt })));
    }
  }

  /* Per account: its positions, or why they could not be read. */
  const positions = new Map<string, Map<string, Position> | string>();
  for (const accountId of new Set(wants.filter((w) => onPosition(w.condition)).map((w) => w.accountId ?? ""))) {
    const account = sources.accounts.find((a) => a.id === accountId);
    if (!account) {
      positions.set(accountId, "The exchange account of this alert is no longer configured.");
      continue;
    }
    try {
      const ex = await clientFor(account, "futures");
      const wanted = [...new Set(wants.filter((w) => w.accountId === accountId).map((w) => toSymbol(w.symbol, "futures")))];
      const list = (await ex.fetchPositions(wanted)) as Position[];
      positions.set(accountId, new Map(list.filter((p) => (p.contracts ?? 0) > 0).map((p) => [String(p.symbol), p])));
    } catch (e) {
      positions.set(accountId, `${account.label}: ${describeExchangeError(e)}`);
    }
  }

  return (symbol, accountId) => {
    const q = priced.get(symbol);
    const r: Reading = { errors: {} };
    if (q && isQuote(q)) {
      r.price = q.price;
      r.change = { "1h": q.change1h, "4h": q.change4h, "24h": q.change24h, "7d": q.change7d };
    } else r.errors!.price = q?.error ?? `No price for ${symbol}.`;
    if (funding.has(symbol)) {
      const f = funding.get(symbol);
      if (f === undefined) r.errors!.funding = `No funding rate for ${symbol}: BytNode does not give it, and no futures account lists it.`;
      else r.funding = f;
    }
    if (windows.has(symbol)) {
      if (calendar) r.events = events.get(symbol) ?? [];
      else r.errors!.events = "The market calendar is off: switch it on for event alerts.";
    }
    if (accountId !== undefined && positions.has(accountId)) {
      const p = positions.get(accountId)!;
      if (typeof p === "string") r.errors!.position = p;
      else {
        const pos = p.get(toSymbol(symbol, "futures"));
        r.position = pos ? { open: true, pnl: pos.unrealizedPnl ?? undefined, pnlPct: pos.percentage ?? undefined, liqPct: liquidationDistance(pos), mark: pos.markPrice ?? undefined } : { open: false };
      }
    }
    if (r.change) for (const k of Object.keys(r.change) as Array<keyof typeof r.change>) if (r.change[k] === undefined) delete r.change[k];
    return r;
  };
}
