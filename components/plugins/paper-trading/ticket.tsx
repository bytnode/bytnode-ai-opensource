"use client";

import { useRef, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import type { Listed, Priced } from "@/lib/plugins/shared/prices";
import { Segmented } from "@/components/ui/segmented";
import { Check } from "@/components/ui/icons";
import { fmt } from "../bits";
import { act } from "../use-plugin-data";
import { useViewActive } from "../view-activity";
import { CASH, baseOf, dayOf, pct, price, toneOf, usdt, type Focus, type PaperState } from "./format";
import { useNoteField } from "./note-field";
import { PairField } from "./pair-field";
import { useMessages } from "@/lib/i18n/react";

/* ---------------------------------------------------------------------------
   The right column (closable, its width the user's): the card — what the
   chosen portfolio is worth, named, on a banknote under glass
   (`note-field.ts`) — then the order ticket, into that portfolio, read top
   to bottom like a sentence: buy or sell, spot or futures, which pair
   (every one BytNode covers, `pair-field.tsx`; its price live under the
   field), at the market or at a price, how much. The
   ticket says what the order will do before it is placed — the quantity,
   the fee, the margin — and its one button names it: "Buy BTC", "Short
   ETH ×5". What was placed is said under it, in the result's words.
--------------------------------------------------------------------------- */

type Side = "buy" | "sell";
type Market = "spot" | "futures";
type Kind = "market" | "limit";
type Unit = "quote" | "base";

const SIDES: Side[] = ["buy", "sell"];
const MARKETS: Market[] = ["spot", "futures"];
const KINDS: Kind[] = ["market", "limit"];
const LEVERAGES = ["1", "2", "3", "5", "10", "20"] as const;
const QUICK = ["BTC", "ETH", "SOL"];

const num = (s: string): number => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function Card({ data }: { data: PaperState | null }) {
  const m = useMessages();
  const t = m.paperTrading.card;
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
        <span className="ptv-card-label">{data?.name ?? t.paperMoney}</span>
        <span className="xch-badge is-paper">PAPER</span>
      </div>
      <p className="ptv-card-value">
        {v?.equity !== undefined ? usdt(v.equity) : data ? "—" : "…"}
        <small>{CASH}</small>
      </p>
      <p className="ptv-card-move">
        {change !== undefined ? (
          <>
            <b>{pct(ret)}</b> {t.since(`${change >= 0 ? "+" : "−"}${usdt(Math.abs(change))}`, data ? dayOf(data.createdAt) : "")}
          </>
        ) : v && v.missing.length ? (
          t.noPrice(v.missing)
        ) : (
          t.readingMarket
        )}
      </p>
      <p className="ptv-card-foot">{data ? t.startedWith(`${usdt(data.capital)} ${CASH}`) : " "}</p>
    </div>
  );
}

type TicketProps = {
  data: PaperState | null;
  portfolio: string;
  settings: Settings;
  /** The pair, shared with the sheet's market chart. */
  symbol: string;
  onSymbol: (symbol: string) => void;
  /** Its live price (the view reads it). */
  quote: Priced | null;
  pairs: Listed[] | null;
  pairsUnavailable: string | null;
  /** An order went in: what it opened or bought, to show under its
      portfolio — nothing for a limit order (not filled yet) or a spot sale. */
  onPlaced: (opened?: Focus) => void;
};

export function Ticket({ data, portfolio, settings, symbol, onSymbol, quote: q, pairs, pairsUnavailable, onPlaced }: TicketProps) {
  const m = useMessages();
  const t = m.paperTrading.ticket;
  const [side, setSide] = useState<Side>("buy");
  const [market, setMarket] = useState<Market>("spot");
  const [kind, setKind] = useState<Kind>("market");
  const [unit, setUnit] = useState<Unit>("quote");
  const [size, setSize] = useState("");
  const [limit, setLimit] = useState("");
  const [leverage, setLeverage] = useState<string>("1");
  const [placing, setPlacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const live = q && !("error" in q) ? q.price : undefined;
  const base = baseOf(symbol) || t.base;

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
  const verb = market === "futures" ? (side === "buy" ? "long" : "short") : side;
  const action = t.action(verb, base, market === "futures" ? lev : null);

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
    const said = side === "buy" ? (market === "futures" ? "longOpened" : "bought") : market === "futures" ? "shortOpened" : "sold";
    setDone(kind === "limit" ? t.limitPlaced(verb, fmt(qty), base, price(num(limit))) : t.filled(said, fmt(qty), base, price(at)));
    onPlaced(kind === "limit" ? undefined : market === "futures" ? { kind: "position", symbol } : side === "buy" ? { kind: "holding", asset: base } : undefined);
  };

  const quick = [...new Set([...(data?.valuation.holdings.map((h) => h.asset) ?? []), ...(data?.valuation.positions.map((p) => baseOf(p.symbol)) ?? []), ...QUICK])].slice(0, 5);

  return (
    <form
      className="ptv-ticket"
      aria-label={m.paperTrading.newOrderLabel}
      onSubmit={(e) => {
        e.preventDefault();
        if (placing) return;
        /* What is missing, said when the order is pressed. */
        if (!ready) return setProblem(!symbol ? t.missingAsset : !(amount > 0) ? t.missingAmount : kind !== "market" && !(num(limit) > 0) ? t.missingLimit : t.waitingPrice);
        void place();
      }}
    >
      <p className="ptv-ticket-title">
        <span className="pv-ink">{t.title}</span>
      </p>

      <div className={`ptv-sides is-${side}`}>
        <Segmented label={t.side} value={side} options={SIDES.map((s) => ({ value: s, label: t.sides[s] }))} onChange={setSide} wide />
      </div>
      <Segmented label={t.market} value={market} options={MARKETS.map((k) => ({ value: k, label: t.markets[k] }))} onChange={setMarket} wide />

      <div className="ptv-field">
        <span className="ptv-field-label">{t.pair}</span>
        <PairField value={symbol} pairs={pairs} unavailable={pairsUnavailable} onChange={onSymbol} />
      </div>
      <div className="ptv-quote">
        <span className="ptv-chips" role="group" aria-label={t.quickPairs}>
          {quick.map((a) => (
            <button key={a} type="button" className={`ptv-chip${base === a ? " is-on" : ""}`} onClick={() => onSymbol(`${a}/${CASH}`)}>
              {a}
            </button>
          ))}
        </span>
        <span className={`ptv-price${q && "error" in q ? " is-error" : ""}`}>{q ? ("error" in q ? q.error : price(q.price)) : symbol ? "…" : ""}</span>
      </div>

      <Segmented label={t.orderType} value={kind} options={KINDS.map((k) => ({ value: k, label: t.kinds[k] }))} onChange={setKind} wide />
      {kind === "limit" && (
        <label className="ptv-field">
          <span className="ptv-field-label">{t.price}</span>
          <input className="wlv-input" inputMode="decimal" value={limit} placeholder={live !== undefined ? price(live) : t.limitPrice} onChange={(e) => setLimit(e.target.value)} />
        </label>
      )}

      <div className="ptv-field">
        <span className="ptv-field-label">{t.amount}</span>
        <div className="ptv-amount">
          <input className="wlv-input" inputMode="decimal" aria-label={t.amount} value={size} placeholder={unit === "quote" ? "100" : "0.01"} onChange={(e) => setSize(e.target.value)} />
          <Segmented
            label={t.amountIn}
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
            {t.max(unit === "quote" ? usdt(max) : fmt(max))}
          </button>
        )}
      </div>

      {market === "futures" && (
        <div className="ptv-field">
          <span className="ptv-field-label">{position ? t.leverageLocked(base, position.leverage) : t.leverage}</span>
          <div className={position ? "ptv-locked" : undefined}>
            <Segmented label={t.leverage} value={lev} options={levOptions.map((l) => ({ value: l, label: `×${l}` }))} onChange={(l) => !position && setLeverage(l)} wide />
          </div>
        </div>
      )}

      <dl className="ptv-estimate">
        <div>
          <dt>{unit === "quote" ? t.quantity : t.cost}</dt>
          <dd>{amount > 0 && Number.isFinite(qty) ? (unit === "quote" ? `≈ ${fmt(qty)} ${base}` : `≈ ${usdt(notional)} ${CASH}`) : "—"}</dd>
        </div>
        {margin !== undefined && (
          <div>
            <dt>{t.margin}</dt>
            <dd>{amount > 0 && Number.isFinite(margin) ? `${usdt(margin)} ${CASH}` : "—"}</dd>
          </div>
        )}
        <div>
          <dt>{t.fee}</dt>
          <dd>{amount > 0 && Number.isFinite(notional) ? `≈ ${usdt(notional * fee)} ${CASH}` : `${fmt(data?.feePercent)} %`}</dd>
        </div>
        <div>
          <dt>{t.available}</dt>
          <dd>{market === "spot" && side === "sell" ? `${fmt(held ?? 0)} ${base}` : `${usdt(cash)} ${CASH}`}</dd>
        </div>
      </dl>

      <button type="submit" className={`ptv-place is-${side}`} disabled={placing}>
        {placing ? t.placing : action}
      </button>
      {problem && <p className="ptv-ticket-problem">{problem}</p>}
      {done && !problem && (
        <p className="ptv-ticket-done">
          <Check />
          {done}
        </p>
      )}
      <p className="ptv-ticket-note">{t.note(fmt(data?.feePercent), fmt(data?.slippagePercent))}</p>
    </form>
  );
}

