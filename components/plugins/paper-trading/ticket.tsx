"use client";

import { useRef, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import type { Priced } from "@/lib/plugins/shared/prices";
import { Segmented } from "@/components/ui/segmented";
import { Check } from "@/components/ui/icons";
import { fmt } from "../bits";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval, useViewActive } from "../view-activity";
import { CASH, baseOf, dayOf, pct, price, toneOf, usdt, type PaperState } from "./format";
import { useNoteField } from "./note-field";

/* ---------------------------------------------------------------------------
   The right column (closable, its width the user's): the card — what the
   chosen portfolio is worth, named, on a banknote under glass
   (`note-field.ts`) — then the order ticket, into that portfolio, read top
   to bottom like a sentence: buy or sell, spot or futures, which pair (its
   price live under the field), at the market or at a price, how much. The
   ticket says what the order will do before it is placed — the quantity,
   the fee, the margin — and its one button names it: "Buy BTC", "Short
   ETH ×5". What was placed is said under it, in the result's words.
--------------------------------------------------------------------------- */

type Side = "buy" | "sell";
type Market = "spot" | "futures";
type Kind = "market" | "limit";
type Unit = "quote" | "base";

const SIDES: Array<{ value: Side; label: string }> = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];
const MARKETS: Array<{ value: Market; label: string }> = [
  { value: "spot", label: "Spot" },
  { value: "futures", label: "Futures" },
];
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
];
const LEVERAGES = ["1", "2", "3", "5", "10", "20"] as const;
const QUICK = ["BTC", "ETH", "SOL"];
/** The ticket's price, read again while the tab is in front. */
const QUOTE_MS = 5_000;

const pairOf = (raw: string): string => {
  const t = raw.trim().toUpperCase();
  if (!t) return "";
  return t.includes("/") ? t : `${t}/${CASH}`;
};

const num = (s: string): number => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function Card({ data }: { data: PaperState | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useViewActive();
  const v = data?.valuation;
  const ret = v?.returnPct;
  useNoteField(canvas, ret === undefined ? 0 : ret / 10, active);
  const change = v?.equity !== undefined && data ? v.equity - data.capital : undefined;
  return (
    <div className={`ptv-card ${toneOf(ret)}`}>
      <canvas ref={canvas} className="ptv-card-canvas" aria-hidden />
      <div className="ptv-card-top">
        <span className="ptv-card-label">{data?.name ?? "Paper money"}</span>
        <span className="xch-badge is-paper">PAPER</span>
      </div>
      <p className="ptv-card-value">
        {v?.equity !== undefined ? usdt(v.equity) : data ? "—" : "…"}
        <small>{CASH}</small>
      </p>
      <p className="ptv-card-move">
        {change !== undefined ? (
          <>
            <b>{pct(ret)}</b> {change >= 0 ? "+" : "−"}
            {usdt(Math.abs(change))} since {data ? dayOf(data.createdAt) : ""}
          </>
        ) : v && v.missing.length ? (
          `No price for ${v.missing.join(", ")}`
        ) : (
          "Reading the market…"
        )}
      </p>
      <p className="ptv-card-foot">{data ? `Started with ${usdt(data.capital)} ${CASH}` : " "}</p>
    </div>
  );
}

export function Ticket({ data, portfolio, settings, onPlaced }: { data: PaperState | null; portfolio: string; settings: Settings; onPlaced: () => void }) {
  const [side, setSide] = useState<Side>("buy");
  const [market, setMarket] = useState<Market>("spot");
  const [kind, setKind] = useState<Kind>("market");
  const [unit, setUnit] = useState<Unit>("quote");
  const [draft, setDraft] = useState("BTC/USDT");
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [size, setSize] = useState("");
  const [limit, setLimit] = useState("");
  const [leverage, setLeverage] = useState<string>("1");
  const [placing, setPlacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The pair is read a moment after the typing stops, not at each key. */
  const type = (raw: string) => {
    setDraft(raw);
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => setSymbol(pairOf(raw)), 450);
  };
  const pick = (s: string) => {
    if (typing.current) clearTimeout(typing.current);
    setDraft(s);
    setSymbol(s);
  };

  const quote = usePluginData<Priced>("paper-trading", "quote", settings, { symbol });
  useAwakeInterval(quote.reload, QUOTE_MS);
  const q = quote.data && quote.data.symbol === symbol ? quote.data : null;
  const live = q && !("error" in q) ? q.price : undefined;
  const base = baseOf(symbol) || "base";

  /* An open position fixes the leverage: the engine refuses another. */
  const position = data?.valuation.positions.find((p) => p.symbol === symbol);
  const lev = market === "futures" ? (position ? String(position.leverage) : leverage) : "1";
  const levOptions = LEVERAGES.includes(lev as (typeof LEVERAGES)[number]) ? LEVERAGES : ([...LEVERAGES, lev] as string[]);

  const fee = (data?.feePercent ?? 0) / 100;
  const slip = (data?.slippagePercent ?? 0) / 100;
  const at = kind === "limit" ? num(limit) : live !== undefined ? live * (side === "buy" ? 1 + slip : 1 - slip) : NaN;
  const amount = num(size);
  const qty = unit === "base" ? amount : amount / at;
  const notional = unit === "quote" ? amount : amount * at;
  const cash = data?.available[CASH];
  const held = data?.available[base];
  const margin = market === "futures" ? notional / Number(lev) : undefined;

  /* The most this order can take, in the ticket's unit. */
  const max = (() => {
    if (!data || !Number.isFinite(at) || at <= 0) return undefined;
    if (market === "spot" && side === "sell") return held !== undefined ? (unit === "base" ? held : held * at) : undefined;
    if (cash === undefined) return undefined;
    const quoteMax = market === "spot" ? cash / (1 + fee) : cash / (1 / Number(lev) + fee);
    return unit === "quote" ? quoteMax : quoteMax / at;
  })();

  const ready = Boolean(data) && symbol !== "" && amount > 0 && Number.isFinite(qty) && (kind === "market" ? live !== undefined : num(limit) > 0);
  const verb = market === "futures" ? (side === "buy" ? "Long" : "Short") : side === "buy" ? "Buy" : "Sell";
  const action = `${verb} ${base}${market === "futures" ? ` ×${lev}` : ""}`;

  const place = async () => {
    setPlacing(true);
    setDone(null);
    const params = {
      portfolio,
      symbol,
      side,
      type: kind,
      market,
      ...(unit === "quote" ? { quoteAmount: amount } : { amount }),
      ...(kind === "limit" ? { price: num(limit) } : {}),
      ...(market === "futures" ? { leverage: Number(lev) } : {}),
    };
    const p = await act("paper-trading", "order", params, settings);
    setPlacing(false);
    setProblem(p);
    if (p) return;
    setSize("");
    const said = side === "buy" ? (market === "futures" ? "Long opened" : "Bought") : market === "futures" ? "Short opened" : "Sold";
    setDone(kind === "limit" ? `Limit order placed: ${verb.toLowerCase()} ${fmt(qty)} ${base} at ${price(num(limit))}.` : `${said}: about ${fmt(qty)} ${base} at ${price(at)}.`);
    onPlaced();
  };

  const quick = [...new Set([...(data?.valuation.holdings.map((h) => h.asset) ?? []), ...(data?.valuation.positions.map((p) => baseOf(p.symbol)) ?? []), ...QUICK])].slice(0, 5);

  return (
    <form
      className="ptv-ticket"
      aria-label="New paper order"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !placing) void place();
      }}
    >
      <p className="ptv-ticket-title">
        <span className="pv-ink">New order</span>
      </p>

      <div className={`ptv-sides is-${side}`}>
        <Segmented label="Side" value={side} options={SIDES} onChange={setSide} wide />
      </div>
      <Segmented label="Market" value={market} options={MARKETS} onChange={setMarket} wide />

      <label className="ptv-field">
        <span className="ptv-field-label">Pair</span>
        <input
          className="wlv-input"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder="BTC/USDT"
          onChange={(e) => type(e.target.value)}
          onBlur={() => pick(pairOf(draft))}
        />
      </label>
      <div className="ptv-quote">
        <span className="ptv-chips" role="group" aria-label="Quick pairs">
          {quick.map((a) => (
            <button key={a} type="button" className={`ptv-chip${base === a ? " is-on" : ""}`} onClick={() => pick(`${a}/${CASH}`)}>
              {a}
            </button>
          ))}
        </span>
        <span className={`ptv-price${q && "error" in q ? " is-error" : ""}`}>{q ? ("error" in q ? q.error : price(q.price)) : symbol ? "…" : ""}</span>
      </div>

      <Segmented label="Order type" value={kind} options={KINDS} onChange={setKind} wide />
      {kind === "limit" && (
        <label className="ptv-field">
          <span className="ptv-field-label">Price</span>
          <input className="wlv-input" inputMode="decimal" value={limit} placeholder={live !== undefined ? price(live) : "Limit price"} onChange={(e) => setLimit(e.target.value)} />
        </label>
      )}

      <div className="ptv-field">
        <span className="ptv-field-label">Amount</span>
        <div className="ptv-amount">
          <input className="wlv-input" inputMode="decimal" aria-label="Amount" value={size} placeholder={unit === "quote" ? "100" : "0.01"} onChange={(e) => setSize(e.target.value)} />
          <Segmented
            label="Amount in"
            value={unit}
            options={[
              { value: "quote", label: CASH },
              { value: "base", label: base },
            ]}
            onChange={setUnit}
          />
        </div>
        {max !== undefined && max > 0 && (
          <button type="button" className="ptv-max" onClick={() => setSize(String(unit === "quote" ? Math.floor(max * 100) / 100 : Math.floor(max * 1e6) / 1e6))}>
            Max {unit === "quote" ? usdt(max) : fmt(max)}
          </button>
        )}
      </div>

      {market === "futures" && (
        <div className="ptv-field">
          <span className="ptv-field-label">Leverage{position ? ` — your ${base} position is at ×${position.leverage}` : ""}</span>
          <div className={position ? "ptv-locked" : undefined}>
            <Segmented label="Leverage" value={lev} options={levOptions.map((l) => ({ value: l, label: `×${l}` }))} onChange={(l) => !position && setLeverage(l)} wide />
          </div>
        </div>
      )}

      <dl className="ptv-estimate">
        <div>
          <dt>{unit === "quote" ? "Quantity" : "Cost"}</dt>
          <dd>{amount > 0 && Number.isFinite(qty) ? (unit === "quote" ? `≈ ${fmt(qty)} ${base}` : `≈ ${usdt(notional)} ${CASH}`) : "—"}</dd>
        </div>
        {margin !== undefined && (
          <div>
            <dt>Margin</dt>
            <dd>{amount > 0 && Number.isFinite(margin) ? `${usdt(margin)} ${CASH}` : "—"}</dd>
          </div>
        )}
        <div>
          <dt>Fee</dt>
          <dd>{amount > 0 && Number.isFinite(notional) ? `≈ ${usdt(notional * fee)} ${CASH}` : `${fmt(data?.feePercent)} %`}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{market === "spot" && side === "sell" ? `${fmt(held ?? 0)} ${base}` : `${usdt(cash)} ${CASH}`}</dd>
        </div>
      </dl>

      <button type="submit" className={`ptv-place is-${side}`} disabled={!ready || placing}>
        {placing ? "Placing…" : action}
      </button>
      {problem && <p className="ptv-ticket-problem">{problem}</p>}
      {done && !problem && (
        <p className="ptv-ticket-done">
          <Check />
          {done}
        </p>
      )}
      <p className="ptv-ticket-note">
        Fills at the live price with {fmt(data?.feePercent)} % fees and {fmt(data?.slippagePercent)} % slippage. Paper money: no exchange is touched.
      </p>
    </form>
  );
}

