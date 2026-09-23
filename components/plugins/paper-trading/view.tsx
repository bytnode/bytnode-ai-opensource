"use client";

import { useState } from "react";
import type { Fill, PaperOrder, Valuation } from "@/lib/plugins/paper-trading/engine";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Close, Refresh } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { useReportExport } from "../use-report-export";
import { Badge } from "../cards";
import { Kpi, Loading, Problem, fmt, money } from "../bits";

/* ---------------------------------------------------------------------------
   The Paper trading tab: the simulated portfolio — equity against the
   starting capital, holdings, futures positions, open orders, fills — an
   order form, the reset, and the export. PAPER everywhere: nothing here is
   real money.
--------------------------------------------------------------------------- */

type State = {
  valuation: Valuation;
  capital: number;
  createdAt: string;
  orders: PaperOrder[];
  fills: Fill[];
  at: string;
  priceErrors: string[];
  feePercent: number;
  slippagePercent: number;
};

type Form = { symbol: string; side: string; type: string; market: string; size: string; unit: string; price: string; leverage: string };

const REFRESH = 15_000;
const USDT = (n: number | undefined) => money(n, "USDT");
const signed = (n: number | undefined) => (n === undefined ? "—" : `${n >= 0 ? "+" : "−"}${USDT(Math.abs(n))}`);
const tone = (n: number | undefined) => (n === undefined || n === 0 ? undefined : n > 0 ? "pv-up" : "pv-down");
const time = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const orderText = (o: PaperOrder) => `${o.side} ${fmt(o.amount)} ${o.symbol}${o.market === "futures" ? ` · futures ×${o.leverage ?? 1}${o.reduceOnly ? " · reduce-only" : ""}` : ""}${o.type === "limit" ? ` · limit ${fmt(o.price)}` : ""}`;

export function PaperTradingView({ settings }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<State>("paper-trading", "state", settings);
  const report = useReportExport("paper-trading", settings);
  const [form, setForm] = useState<Form>({ symbol: "BTC/USDT", side: "buy", type: "market", market: "spot", size: "", unit: "quote", price: "", leverage: "1" });
  const [problem, setProblem] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [resetting, setResetting] = useState(false);

  useAwakeInterval(reload, REFRESH);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("paper-trading", action, params, settings);
    setProblem(p);
    reload();
    return p;
  };

  const place = async () => {
    const size = Number(form.size);
    setPlacing(true);
    const p = await run("order", {
      symbol: form.symbol,
      side: form.side,
      type: form.type,
      market: form.market,
      ...(form.unit === "quote" ? { quoteAmount: size } : { amount: size }),
      ...(form.type === "limit" ? { price: Number(form.price) } : {}),
      ...(form.market === "futures" ? { leverage: Number(form.leverage) || 1 } : {}),
    });
    setPlacing(false);
    if (!p) set({ size: "" });
  };

  const base = form.symbol.split("/")[0]?.toUpperCase() || "base";
  const ready = form.symbol.trim() && Number(form.size) > 0 && (form.type === "market" || Number(form.price) > 0);
  const v = data?.valuation;

  return (
    <>
      <div className="pv-toolbar">
        <Badge badge="PAPER" />
        <span className="pv-muted">
          Simulated with paper money — fees {data ? `${fmt(data.feePercent)} %` : "…"}, slippage {data ? `${fmt(data.slippagePercent)} %` : "…"}.
        </span>
        {loading && data && <span className="pv-chip">Updating…</span>}
        <span className="tb-space" />
        {report.button(!data)}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetting(true)}>
          <Refresh />
          Reset
        </button>
      </div>
      {report.result}
      {error && <Problem message={error} />}
      {data?.priceErrors.map((m) => <Problem key={m} message={m} />)}
      {!data || !v ? (
        <Loading />
      ) : (
        <>
          <div className="pv-kpis">
            <Kpi label="Equity" value={v.equity === undefined ? "—" : USDT(v.equity)} sub={v.returnPct === undefined ? `capital ${USDT(data.capital)}` : <span className={tone(v.returnPct)}>{`${v.returnPct >= 0 ? "+" : ""}${v.returnPct.toFixed(2)} % on ${USDT(data.capital)}`}</span>} />
            <Kpi label="Realized" value={<span className={tone(v.realized)}>{signed(v.realized)}</span>} sub={`fees ${USDT(v.fees)}`} />
            <Kpi label="Unrealized" value={<span className={tone(v.unrealized)}>{signed(v.unrealized)}</span>} sub={`${v.positions.length} position(s) · ${data.orders.length} open order(s)`} />
            <Kpi label="Cash" value={USDT(v.cash)} sub={`since ${data.createdAt.slice(0, 10)}`} />
          </div>

          <form
            className="pv-form pt-form"
            onSubmit={(e) => {
              e.preventDefault();
              void place();
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="pt-symbol">
                Pair
              </label>
              <input id="pt-symbol" className="field-input" value={form.symbol} onChange={(e) => set({ symbol: e.target.value })} placeholder="BTC/USDT" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pt-side">
                Side
              </label>
              <Select id="pt-side" label="Side" value={form.side} options={[{ value: "buy", label: "Buy / long" }, { value: "sell", label: "Sell / short" }]} onChange={(side) => set({ side })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pt-market">
                Market
              </label>
              <Select id="pt-market" label="Market" value={form.market} options={[{ value: "spot", label: "Spot" }, { value: "futures", label: "Futures" }]} onChange={(market) => set({ market })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pt-type">
                Type
              </label>
              <Select id="pt-type" label="Type" value={form.type} options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]} onChange={(type) => set({ type })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pt-size">
                Quantity
              </label>
              <input id="pt-size" className="field-input" inputMode="decimal" value={form.size} onChange={(e) => set({ size: e.target.value })} placeholder={form.unit === "quote" ? "100" : "0.01"} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pt-unit">
                In
              </label>
              <Select id="pt-unit" label="Unit" value={form.unit} options={[{ value: "quote", label: "USDT" }, { value: "base", label: base }]} onChange={(unit) => set({ unit })} />
            </div>
            {form.type === "limit" && (
              <div className="field">
                <label className="field-label" htmlFor="pt-price">
                  Limit price
                </label>
                <input id="pt-price" className="field-input" inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} />
              </div>
            )}
            {form.market === "futures" && (
              <div className="field">
                <label className="field-label" htmlFor="pt-leverage">
                  Leverage
                </label>
                <input id="pt-leverage" className="field-input" inputMode="numeric" value={form.leverage} onChange={(e) => set({ leverage: e.target.value })} />
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={!ready || placing}>
              {placing ? "Placing…" : "Place paper order"}
            </button>
          </form>
          {problem && <Problem message={problem} />}

          <section className="pv-section">
            <h2 className="pv-section-title">Spot holdings</h2>
            {v.holdings.length === 0 ? (
              <p className="pv-note">Only paper cash for now.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th className="num">Amount</th>
                      <th className="num">Average</th>
                      <th className="num">Price</th>
                      <th className="num">Value</th>
                      <th className="num">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.holdings.map((h) => (
                      <tr key={h.asset}>
                        <td>
                          <strong>{h.asset}</strong>
                        </td>
                        <td className="num">{fmt(h.amount)}</td>
                        <td className="num">{fmt(h.avgPrice)}</td>
                        <td className="num">{fmt(h.price)}</td>
                        <td className="num">{USDT(h.value)}</td>
                        <td className={`num ${tone(h.unrealized) ?? ""}`}>{signed(h.unrealized)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {v.positions.length > 0 && (
            <section className="pv-section">
              <h2 className="pv-section-title">Futures positions</h2>
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Pair</th>
                      <th>Side</th>
                      <th className="num">Size</th>
                      <th className="num">Entry</th>
                      <th className="num">Mark</th>
                      <th className="num">Margin</th>
                      <th className="num">PnL</th>
                      <th className="num">Liquidation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.positions.map((p) => (
                      <tr key={p.symbol}>
                        <td>
                          <strong>{p.symbol}</strong>
                        </td>
                        <td>
                          {p.side} ×{p.leverage}
                        </td>
                        <td className="num">{fmt(p.amount)}</td>
                        <td className="num">{fmt(p.entryPrice)}</td>
                        <td className="num">{fmt(p.mark)}</td>
                        <td className="num">{USDT(p.margin)}</td>
                        <td className={`num ${tone(p.unrealized) ?? ""}`}>{signed(p.unrealized)}</td>
                        <td className="num">{fmt(p.liquidation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.orders.length > 0 && (
            <section className="pv-section">
              <h2 className="pv-section-title">Open orders</h2>
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td>{orderText(o)}</td>
                        <td className="pv-muted">{time(o.createdAt)}</td>
                        <td className="pv-actions">
                          <button type="button" className="st-icon" onClick={() => void run("cancel", { orderId: o.id })} aria-label={`Cancel ${orderText(o)}`} title="Cancel">
                            <Close />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="pv-section">
            <h2 className="pv-section-title">Fills</h2>
            {data.fills.length === 0 ? (
              <p className="pv-note">No fill yet. Place an order above, or ask an agent: &quot;paper-buy 200 USDT of ETH&quot;.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Fill</th>
                      <th className="num">Price</th>
                      <th className="num">Fee</th>
                      <th className="num">Realized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fills.map((f) => (
                      <tr key={f.id}>
                        <td className="pv-muted">{time(f.at)}</td>
                        <td>{f.liquidation ? <strong className="pv-down">Liquidated {f.symbol}</strong> : `${f.side} ${fmt(f.amount)} ${f.symbol}${f.market === "futures" ? " · futures" : ""}`}</td>
                        <td className="num">{fmt(f.price)}</td>
                        <td className="num">{USDT(f.fee)}</td>
                        <td className={`num ${tone(f.realizedPnl) ?? ""}`}>{f.realizedPnl ? signed(f.realizedPnl) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="pv-note">Prices from BytNode, or from your exchange for a pair BytNode does not cover. A paper result is never a real performance.</p>
        </>
      )}
      {resetting && (
        <ConfirmDialog
          title="Reset the paper portfolio?"
          body="Every paper holding, position, order and fill is erased; the cash goes back to the starting capital set in Settings → Plugins."
          confirmLabel="Reset"
          onConfirm={() => {
            setResetting(false);
            void run("reset", {});
          }}
          onCancel={() => setResetting(false)}
        />
      )}
    </>
  );
}
