"use client";

import { useState } from "react";
import { isFrequency } from "@/lib/plugins/core/frequency";
import type { DcaPlan, PlanSummary, Purchase } from "@/lib/plugins/dca/plans";
import { Select } from "@/components/ui/select";
import { Plus, Trash } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { Badge } from "../cards";
import { Loading, Problem, fmt } from "../bits";

/* ---------------------------------------------------------------------------
   The DCA tab: the recurring purchases — next due date, what each bought
   and at what average price — a creation form, and the history. A real
   plan's purchases wait for the user's confirmation in the notification
   center; this page never buys.
--------------------------------------------------------------------------- */

type State = { plans: Array<DcaPlan & { summary: PlanSummary }>; purchases: Purchase[]; paperCash: string };

const REFRESH = 15_000;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const STATUS: Record<Purchase["status"], string> = { filled: "bought", proposed: "awaiting your confirmation", refused: "refused", expired: "not confirmed in time", failed: "failed", skipped: "skipped" };

export function DcaView({ settings }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<State>("dca", "state", settings);
  const accounts = settings.keys.exchanges;
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("every monday at 09:00");
  const [destination, setDestination] = useState("paper");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  useAwakeInterval(reload, REFRESH);

  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("dca", action, params, settings);
    setProblem(p);
    reload();
    return p;
  };
  const create = async () => {
    const p = await run("create", { symbol, quoteAmount: Number(amount), frequency, destination, ...(destination === "exchange" ? { accountId } : {}) });
    if (!p) setAmount("");
  };

  const badge = (plan: DcaPlan) => (plan.destination === "paper" ? "PAPER" : accounts.find((a) => a.id === plan.accountId)?.testnet ? "TESTNET" : "LIVE");
  const planOf = (id: string) => data?.plans.find((p) => p.id === id);
  const ready = symbol.trim() && Number(amount) > 0 && isFrequency(frequency) && (destination === "paper" || accountId);

  return (
    <>
      <form
        className="pv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="dca-symbol">
            Buy
          </label>
          <input id="dca-symbol" className="field-input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="BTC/USDT" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dca-amount">
            Each time <small>in quote</small>
          </label>
          <input id="dca-amount" className="field-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dca-frequency">
            When
          </label>
          <input id="dca-frequency" className="field-input" value={frequency} onChange={(e) => setFrequency(e.target.value)} aria-invalid={!isFrequency(frequency)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dca-destination">
            Where
          </label>
          <Select
            id="dca-destination"
            label="Where"
            value={destination}
            options={[
              { value: "paper", label: "Paper portfolio (simulated)" },
              { value: "exchange", label: "Exchange account (real, confirmed)" },
            ]}
            onChange={setDestination}
          />
        </div>
        {destination === "exchange" && (
          <div className="field">
            <label className="field-label" htmlFor="dca-account">
              Account
            </label>
            <Select id="dca-account" label="Account" value={accountId} placeholder="No exchange account" options={accounts.map((a) => ({ value: a.id, label: `${a.label}${a.testnet ? " (testnet)" : ""}` }))} onChange={setAccountId} />
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          <Plus />
          Create
        </button>
      </form>
      <p className="pv-note">
        Paper plans buy by themselves{data ? ` (pairs in ${data.paperCash})` : ""}. A real plan PROPOSES each purchase in the notification center, after checking the market, the minimum and your balance: nothing is bought without your confirmation. Plans run while the app is open; a date missed while it was closed is proposed when it opens.
      </p>
      {problem && <Problem message={problem} />}
      {error && <Problem message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <section className="pv-section">
            <h2 className="pv-section-title">
              Plans
              {loading && <span className="pv-chip">Updating…</span>}
            </h2>
            {data.plans.length === 0 ? (
              <p className="pv-note">No plan yet. Create one above, or ask an agent: &quot;buy 50 USDT of ETH every Monday in paper&quot;.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>When</th>
                      <th>Next</th>
                      <th className="num">Invested</th>
                      <th className="num">Bought</th>
                      <th className="num">Average</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.plans.map((p) => {
                      const [base, quote] = p.symbol.split("/");
                      return (
                        <tr key={p.id}>
                          <td>
                            <Badge badge={badge(p)} /> <strong>{`${fmt(p.quoteAmount)} ${quote} of ${base}`}</strong>
                            {p.destination === "exchange" && <span className="pv-muted"> · {accounts.find((a) => a.id === p.accountId)?.label ?? "account removed"}</span>}
                            {p.summary.pending > 0 && <span className="pv-chip pv-tag">{p.summary.pending} to confirm</span>}
                          </td>
                          <td className="pv-muted">{p.frequency}</td>
                          <td className="pv-muted">{p.status === "active" ? when(p.nextDue) : p.status}</td>
                          <td className="num">{p.summary.purchases ? `${fmt(p.summary.invested, 2)} ${quote}` : "—"}</td>
                          <td className="num">{p.summary.purchases ? `${fmt(p.summary.amount)} ${base}` : "—"}</td>
                          <td className="num">{fmt(p.summary.average)}</td>
                          <td className="pv-actions">
                            {p.status !== "ended" && (
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run("update", { id: p.id, action: p.status === "paused" ? "resume" : "pause" })}>
                                {p.status === "paused" ? "Resume" : "Pause"}
                              </button>
                            )}
                            <button type="button" className="st-icon" onClick={() => void run("update", { id: p.id, action: "delete" })} aria-label={`Delete the plan ${p.symbol}`} title="Delete">
                              <Trash />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="pv-section">
            <h2 className="pv-section-title">Purchases</h2>
            {data.purchases.length === 0 ? (
              <p className="pv-note">Nothing yet.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Due</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th className="num">Quantity</th>
                      <th className="num">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.purchases.map((u) => {
                      const plan = planOf(u.planId);
                      return (
                        <tr key={u.id}>
                          <td className="pv-muted">
                            {when(u.due)}
                            {u.late ? " · missed" : ""}
                          </td>
                          <td>
                            <Badge badge={u.mode === "paper" ? "PAPER" : u.mode === "testnet" ? "TESTNET" : "LIVE"} /> {plan?.symbol ?? "deleted plan"}
                          </td>
                          <td className={u.status === "failed" ? "pv-down" : undefined} title={u.detail}>
                            {STATUS[u.status]}
                            {u.status === "failed" && u.detail ? `: ${u.detail}` : ""}
                          </td>
                          <td className="num">{fmt(u.amount)}</td>
                          <td className="num">{fmt(u.price)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
