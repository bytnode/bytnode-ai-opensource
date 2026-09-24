"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import type { Purchase } from "@/lib/plugins/dca/plans";
import { frequencyWords, nextDue, type Figures, type PlanRow } from "@/lib/plugins/dca/view-model";
import type { Candle } from "@/lib/plugins/shared/candle";
import { Pencil, Plus, Refresh, Settings as Gear, Trash } from "@/components/ui/icons";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import { badgeClass, badgeOf, money, pct, signedMoney, toneOf, when } from "./format";

/* ---------------------------------------------------------------------------
   The right sheet: a group, or one of its DCAs.

   A group with no DCA offers one thing: to add a DCA. With some — what they
   are worth against what went in, the curve of that value since the first
   purchase (a purchase is not a gain: the daily returns take it off), the
   figures, its DCAs as tiles (and a tile to add one), the purchases. A DCA
   — the same in detail: what it bought, its average price against the
   current one, its next purchase; "Configure" opens its settings, and it
   can be paused or deleted. Nothing here buys: a real DCA's purchases wait
   for the user's click in the notification center.
--------------------------------------------------------------------------- */

export type Shown = { kind: "group"; id: string; rename?: boolean } | { kind: "plan"; id: string };

type Props = {
  shown: Shown;
  plans: PlanRow[];
  groups: DcaGroup[];
  purchases: Purchase[];
  accounts: ExchangeAccount[];
  figures: (plans: PlanRow[]) => Figures;
  unit: (plans: PlanRow[]) => string;
  series: Candle[] | null;
  status: string;
  problem: string | null;
  onReload: () => void;
  onGroup: (id: string) => void;
  onPlan: (id: string) => void;
  /** Opens the configuration: a new DCA in a group, or a DCA's own. */
  onConfigure: (target: { groupId: string } | { planId: string }) => void;
  onPause: (id: string, action: "pause" | "resume") => void;
  onDeletePlan: (id: string) => void;
  onRenameGroup: (id: string, name: string) => Promise<string | null>;
  onDeleteGroup: (id: string) => void;
};

const STATUS: Record<Purchase["status"], string> = { filled: "Bought", proposed: "Awaiting your confirmation", refused: "Refused", expired: "Not confirmed in time", failed: "Failed", skipped: "Skipped" };
const STATUS_TONE: Record<Purchase["status"], string> = { filled: "var(--dca-accent)", proposed: "var(--cal-unlock)", refused: "var(--down)", expired: "var(--down)", failed: "var(--down)", skipped: "rgba(var(--ink), 0.35)" };
const SHOWN = 30;

/** What a DCA is called: its name, else its pair and amount. */
export const planTitle = (p: PlanRow) => p.name ?? `${p.symbol.split("/")[0]} · ${p.quoteAmount} ${p.symbol.split("/")[1]}`;

export function Sheet(props: Props) {
  const { shown, plans, groups, purchases, accounts, figures, unit, series, status, problem, onReload, onGroup, onPlan, onConfigure } = props;
  const plan = shown.kind === "plan" ? plans.find((p) => p.id === shown.id) : undefined;
  const group = groups.find((g) => g.id === (shown.kind === "group" ? shown.id : plan?.groupId));
  const inside = plan ? [plan] : plans.filter((p) => p.groupId === group?.id);
  const f = figures(inside);
  const u = unit(inside);
  const ids = new Set(inside.map((p) => p.id));
  const bought = purchases.filter((p) => ids.has(p.planId));
  const [renaming, setRenaming] = useState<string | null>(shown.kind === "group" && shown.rename && group ? group.name : null);
  const [renameProblem, setRenameProblem] = useState<string | null>(null);

  if (!group || (shown.kind === "plan" && !plan)) {
    return (
      <main className="wlv-pane wlv-sheet dcv-sheet">
        <div className="dcv-empty">
          <b>{shown.kind === "plan" ? "This DCA is gone." : "This group is gone."}</b>
        </div>
      </main>
    );
  }

  const base = plan?.symbol.split("/")[0];
  const quote = plan?.symbol.split("/")[1];
  const badge = plan ? badgeOf(plan, accounts) : null;
  const next = nextDue(inside);
  const active = inside.filter((p) => p.status === "active").length;
  const empty = !plan && inside.length === 0;

  const rename = async () => {
    if (renaming === null) return;
    const p = await props.onRenameGroup(group.id, renaming);
    setRenameProblem(p);
    if (!p) setRenaming(null);
  };

  return (
    <main className="wlv-pane wlv-sheet dcv-sheet">
      <header className="wlv-head">
        <div className="wlv-title-block">
          {!plan && renaming !== null ? (
            <form
              className="dcv-rename"
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <input className="wlv-input" aria-label="Group name" value={renaming} autoFocus maxLength={40} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
              <button type="submit" className="dcv-button is-primary" disabled={!renaming.trim()}>
                Save
              </button>
              <button type="button" className="dcv-button" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              {renameProblem && <span className="dcv-problem">{renameProblem}</span>}
            </form>
          ) : (
            <h2 className="wlv-sheet-title">
              {badge && <span className={`${badgeClass(badge)} dcv-title-badge`}>{badge}</span>}
              <span className="pv-ink">{plan ? planTitle(plan) : group.name}</span>
            </h2>
          )}
          <p className="wlv-sheet-sub">
            {plan ? (
              <>
                <button type="button" className="dcv-crumb" onClick={() => onGroup(group.id)}>
                  {group.name}
                </button>
                {` · ${plan.symbol} · ${frequencyWords(plan.frequency)} · ${plan.destination === "paper" ? "paper portfolio, automatic" : `${accounts.find((a) => a.id === plan.accountId)?.label ?? "a removed account"}, each purchase confirmed by you`}${plan.status !== "active" ? ` · ${plan.status}` : ""}`}
              </>
            ) : empty ? (
              "No DCA in this group yet"
            ) : (
              `${inside.length} DCA${inside.length === 1 ? "" : "s"} · purchases run while the app is open`
            )}
          </p>
        </div>
        {status && <span className="wlv-status">{status}</span>}
        {!plan && renaming === null && (
          <>
            {!empty && (
              <button type="button" className="dcv-button is-primary" onClick={() => onConfigure({ groupId: group.id })}>
                <Plus />
                Add a DCA
              </button>
            )}
            <button type="button" className="wlv-icon" onClick={() => setRenaming(group.name)} aria-label="Rename the group" title="Rename">
              <Pencil />
            </button>
            <button type="button" className="wlv-icon" onClick={() => props.onDeleteGroup(group.id)} aria-label="Delete the group" title="Delete the group and its DCAs">
              <Trash />
            </button>
          </>
        )}
        {plan && (
          <>
            <button type="button" className="dcv-button is-primary" onClick={() => onConfigure({ planId: plan.id })}>
              <Gear />
              Configure
            </button>
            {plan.status !== "ended" && (
              <button type="button" className="dcv-button" onClick={() => props.onPause(plan.id, plan.status === "paused" ? "resume" : "pause")}>
                {plan.status === "paused" ? "Resume" : "Pause"}
              </button>
            )}
            <button type="button" className="wlv-icon" onClick={() => props.onDeletePlan(plan.id)} aria-label="Delete the DCA" title="Delete the DCA">
              <Trash />
            </button>
          </>
        )}
        {!empty && (
          <button type="button" className="wlv-icon" onClick={onReload} aria-label="Read again" title="Read again">
            <Refresh />
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}

      <div className="wlv-body dcv-body">
        {empty ? (
          /* An empty group: one thing to do. */
          <button type="button" className="dcv-start" onClick={() => onConfigure({ groupId: group.id })}>
            <span className="dcv-start-icon" aria-hidden>
              <Plus />
            </span>
            <b>Add a DCA</b>
            <span>Choose an asset, an amount and a schedule — in the paper portfolio, or on an exchange account with your confirmation each time.</span>
          </button>
        ) : (
          <>
            <div className="dcv-hero">
              <p className="dcv-hero-value">
                <span>{f.value !== undefined ? fmt(f.value, 2) : fmt(f.invested, 2)}</span>
                <small>{u}</small>
              </p>
              {f.pct !== undefined ? (
                <p className="dcv-hero-move">
                  <b className={`wlv-pill ${toneOf(f.pct)}`}>{pct(f.pct)}</b>
                  <span>
                    {signedMoney(f.pnl, u)} on {money(f.invested, u)} invested
                  </span>
                </p>
              ) : (
                <p className="dcv-hero-move">{f.purchases ? "Reading the current prices…" : `Nothing bought yet${next ? ` — the first purchase is due ${when(next)}` : ""}.`}</p>
              )}
            </div>

            <Part title="Value" sub="what was bought, at each day's close — a purchase is not a gain">
              <div className="dcv-chart">
                <PriceChart candles={series ?? []} interval="1d" mode="line" fit returns message={series === null ? "Reading the prices…" : series.length < 2 ? "The curve starts with the first purchase." : null} />
              </div>
              <div className="wlv-insights dcv-metrics" style={{ "--cols": plan ? 4 : 3 } as CSSProperties}>
                <Metric label="Invested" value={money(f.invested, u)} sub={`${f.purchases} purchase${f.purchases === 1 ? "" : "s"}${f.pending ? ` · ${f.pending} to confirm` : ""}`} />
                <Metric label="Value" value={money(f.value, u)} sub="at the current price" />
                <Metric label="Result" value={signedMoney(f.pnl, u)} tone={toneOf(f.pnl)} sub={f.pct !== undefined ? pct(f.pct) : "—"} />
                {plan ? (
                  <>
                    <Metric label="Bought" value={f.amount ? `${fmt(f.amount)} ${base}` : "—"} sub={`${plan.quoteAmount} ${quote} each time`} />
                    <Metric label="Average price" value={f.average !== undefined ? `${fmt(f.average)} ${quote}` : "—"} sub="fees apart" />
                    <Metric label="Current price" value={f.price !== undefined ? `${fmt(f.price)} ${quote}` : "—"} tone={f.price !== undefined && f.average !== undefined ? toneOf(f.price - f.average) : undefined} sub={f.price !== undefined && f.average !== undefined ? `${pct(((f.price - f.average) / f.average) * 100)} from the average` : "—"} />
                    <Metric label="Next purchase" value={plan.status === "active" ? when(plan.nextDue) : plan.status} sub={frequencyWords(plan.frequency)} />
                    <Metric label="Ends" value={plan.endAt ? when(plan.endAt) : "Never"} sub={plan.endAt ? "then the DCA stops" : "until you pause it"} />
                  </>
                ) : (
                  <>
                    <Metric label="DCAs" value={`${inside.length}`} sub={`${active} active${inside.length - active ? ` · ${inside.length - active} paused or ended` : ""}`} />
                    <Metric label="Next purchase" value={when(next)} sub={next ? (inside.find((p) => p.nextDue === next)?.symbol ?? "") : "none planned"} />
                    <Metric label="Pending" value={`${f.pending}`} sub="real purchases awaiting your click" />
                  </>
                )}
              </div>
            </Part>

            {!plan && (
              <Part title="DCAs" sub="open one to see it in detail, or to configure it">
                <div className="dcv-plans">
                  {inside.map((p) => {
                    const pf = figures([p]);
                    const b = badgeOf(p, accounts);
                    return (
                      <button key={p.id} type="button" className={`dcv-plan${p.status !== "active" ? " is-idle" : ""}`} onClick={() => onPlan(p.id)}>
                        <span className="dcv-plan-name">
                          <span className="dcv-item-top">
                            <b>{planTitle(p)}</b>
                            <span className={badgeClass(b)}>{b}</span>
                            {p.status !== "active" && <span className="dcv-state">{p.status}</span>}
                          </span>
                          <small>
                            {p.name ? `${p.quoteAmount} ${p.symbol.split("/")[1]} of ${p.symbol.split("/")[0]} · ` : ""}
                            {frequencyWords(p.frequency)}
                          </small>
                        </span>
                        <span className="dcv-plan-cell">
                          <small>Next</small>
                          {p.status === "active" ? when(p.nextDue) : "—"}
                        </span>
                        <span className="dcv-plan-cell">
                          <small>Invested</small>
                          {money(pf.invested, p.symbol.split("/")[1])}
                        </span>
                        <span className={`wlv-pill dcv-pill ${toneOf(pf.pct)}`}>{pf.pct !== undefined ? pct(pf.pct) : "—"}</span>
                      </button>
                    );
                  })}
                  <button type="button" className="dcv-plan dcv-plan-add" onClick={() => onConfigure({ groupId: group.id })}>
                    <Plus />
                    Add a DCA to this group
                  </button>
                </div>
              </Part>
            )}

            <Part title="Purchases" sub={bought.length ? `${bought.filter((p) => p.status === "filled").length} bought · ${bought.filter((p) => p.status === "proposed").length} awaiting your confirmation` : "none yet"}>
              {bought.length === 0 ? (
                <p className="dcv-quiet">{next ? `The first one is due ${when(next)}.` : "No purchase, and nothing planned."}</p>
              ) : (
                <div className="dcv-buys">
                  {bought.slice(0, SHOWN).map((u2) => {
                    const p = plans.find((x) => x.id === u2.planId);
                    const b = p?.symbol.split("/")[0] ?? "";
                    return (
                      <div key={u2.id} className="dcv-buy" style={{ "--tone": STATUS_TONE[u2.status] } as CSSProperties}>
                        <span className="dcv-buy-when">{when(u2.at)}</span>
                        <span className="dcv-buy-what">
                          <b>{STATUS[u2.status]}</b>
                          {u2.status === "filled" && u2.amount !== undefined ? ` ${fmt(u2.amount)} ${b}` : ` ${p?.quoteAmount ?? ""} ${p?.symbol.split("/")[1] ?? ""} of ${b}`}
                          {u2.status === "filled" && u2.price !== undefined ? <small> at {fmt(u2.price)}</small> : null}
                          {u2.late ? <small> · missed while the app was closed</small> : null}
                          {u2.detail && u2.status !== "filled" ? <small> · {u2.detail}</small> : null}
                        </span>
                        <span className={badgeClass(u2.mode === "paper" ? "PAPER" : u2.mode === "testnet" ? "TESTNET" : "LIVE")}>{u2.mode.toUpperCase()}</span>
                      </div>
                    );
                  })}
                  {bought.length > SHOWN && <p className="dcv-quiet dcv-buys-more">and {bought.length - SHOWN} earlier</p>}
                </div>
              )}
            </Part>
          </>
        )}
      </div>
    </main>
  );
}

function Part({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="dcv-part">
      <header className="dcv-part-head">
        <h3>{title}</h3>
        {sub && <span>{sub}</span>}
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="wlv-insight dcv-metric">
      <span className="wlv-insight-label">{label}</span>
      <span className={`wlv-insight-value ${tone ?? ""}`}>{value}</span>
      <span className="wlv-insight-sub">{sub}</span>
    </div>
  );
}
