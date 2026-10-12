"use client";

import { useEffect, useState } from "react";
import type { ExchangeAccount, Settings } from "@/lib/domain/types";
import type { Quote } from "@/lib/plugins/shared/quote";
import { transportHeaders } from "@/lib/tools/transport";
import { useViewActive } from "./view-activity";

/* ---------------------------------------------------------------------------
   Live prices in a view: the pairs' quotes pushed by the app's server
   (`app/api/market/live/route.ts`), which streams them from BytNode's
   WebSocket — no reading again and again, no BytNode quota spent.

   The stream is open while the view is in front, for the pairs asked (a
   new list or a new key opens a new one), and comes back by itself when
   it drops. `quotes` holds the last quote of each pair; `state` and
   `problem` say whether the prices are live, and why not.
--------------------------------------------------------------------------- */

export type LiveState = "idle" | "connecting" | "live" | "unavailable";

export type LiveQuotes = {
  quotes: ReadonlyMap<string, Quote>;
  /** A pair with no price, and why. */
  errors: ReadonlyMap<string, string>;
  state: LiveState;
  problem: string | null;
};

/* After a drop, the stream comes back after a while that grows (a server
   that refuses is not asked again and again). */
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

type Event = { type: "quote"; quote: Quote } | { type: "error"; symbol: string; error: string } | { type: "status"; state: LiveState; problem: string | null };

const EMPTY: LiveQuotes = { quotes: new Map(), errors: new Map(), state: "idle", problem: null };

export function useLiveQuotes(symbols: readonly string[], settings: Settings): LiveQuotes {
  const active = useViewActive();
  const pairs = [...new Set(symbols.filter(Boolean))].sort().join(",");
  const key = settings.keys.bytnode;
  /* What the quotes held are for: these pairs, with this key. */
  const wanted = pairs ? `${pairs}|${key.length}:${key.slice(-6)}` : "";
  /* By value: a new array with the same accounts opens no new stream. */
  const accounts = JSON.stringify(settings.keys.exchanges ?? []);
  const [live, setLive] = useState<LiveQuotes & { for: string }>({ ...EMPTY, for: "" });

  useEffect(() => {
    if (!active || !wanted) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const headers = transportHeaders({ bytnodeKey: key, exchangeAccounts: JSON.parse(accounts) as ExchangeAccount[] });

    const apply = (e: Event) =>
      setLive((prev) => {
        const base = prev.for === wanted ? prev : { ...EMPTY, for: wanted };
        if (e.type === "status") return { ...base, state: e.state, problem: e.problem };
        if (e.type === "error") {
          if (base.quotes.has(e.symbol)) return base;
          return { ...base, errors: new Map(base.errors).set(e.symbol, e.error) };
        }
        const before = base.quotes.get(e.quote.symbol);
        if (before && Date.parse(before.at) > Date.parse(e.quote.at)) return base;
        const errors = base.errors.has(e.quote.symbol) ? new Map(base.errors) : base.errors;
        if (errors !== base.errors) (errors as Map<string, string>).delete(e.quote.symbol);
        return { ...base, quotes: new Map(base.quotes).set(e.quote.symbol, e.quote), errors };
      });

    const connect = async () => {
      controller = new AbortController();
      try {
        const res = await fetch(`/api/market/live?symbols=${encodeURIComponent(pairs)}`, { headers, signal: controller.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        attempt = 0;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) {
              try {
                apply(JSON.parse(line) as Event);
              } catch {
                /* a line cut short: the next one comes */
              }
            }
            nl = buffer.indexOf("\n");
          }
        }
      } catch {
        /* dropped, or stopped */
      }
      if (stopped) return;
      /* Until it is back, the prices on screen are not live. */
      setLive((prev) => (prev.for === wanted && prev.state === "live" ? { ...prev, state: "connecting" } : prev));
      retry = setTimeout(() => void connect(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
    };
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      if (retry) clearTimeout(retry);
    };
  }, [active, wanted, pairs, key, accounts]);

  return live.for === wanted ? live : EMPTY;
}
