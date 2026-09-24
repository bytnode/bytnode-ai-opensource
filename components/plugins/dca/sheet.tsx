"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import type { Purchase } from "@/lib/plugins/dca/plans";
import { frequencyWords, nextDue, type Figures, type PlanRow } from "@/lib/plugins/dca/view-model";
import type { Candle } from "@/lib/plugins/shared/candle";
import { Select } from "@/components/ui/select";
import { Pencil, Plus, Refresh, Trash } from "@/components/ui/icons";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import { badgeClass, badgeOf, money, pct, signedMoney, toneOf, when } from "./format";
import type { Scope } from "./view";

/* ---------------------------------------------------------------------------
   The right sheet: what is open in the column. "All plans" or a group —
   their value against what was invested, the curve of that value since the
   first purchase (a purchase is not a gain: the daily returns take it
   off), the plans as tiles (a group's own, and a tile to add one to it),
   the purchases. A plan — the same, in detail: its quantity, its average
   price against the current one, its next due date; pause, move, delete.
   Nothing here buys: a real plan's purchases wait for the user's click in
   the notification center.
--------------------------------------------------------------------------- */

type Props = {
  scope: Exclude<Scope, { kind: "new" }>;
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
  onScope: (s: Scope) => void;
  onPlan: (id: string, action: "pause" | "resume") => void;
  onMove: (id: string, groupId: string | null) => void;
  onDeletePlan: (id: string) => void;
  onRenameGroup: (id: string, name: string) => Promise<string | null>;
  onDeleteGroup: (id: string) => void;
};

const STATUS: Record<Purchase["status"], string> = { filled: "Bought", proposed: "Awaiting your confirmation", refused: "Refused", expired: "Not confirmed in time", failed: "Failed", skipped: "Skipped" };
const STATUS_TONE: Record<Purchase["status"], string> = { filled: "var(--dca-accent)", proposed: "var(--cal-unlock)", refused: "var(--down)", expired: "var(--down)", failed: "var(--down)", skipped: "rgba(var(--ink), 0.35)" };
const SHOWN = 30;

export function Sheet(props: Props) {
  const { scope, plans, groups, purchases, accounts, figures, unit, series, status, problem, onReload, onScope } = props;
  const group = scope.kind === "group" ? groups.find((g) => g.id === scope.id) : undefined;
  const plan = scope.kind === "plan" ? plans.find((p) => p.id === scope.id) : undefined;
  const shown = scope.kind === "all" ? plans : scope.kind === "group" ? plans.filter((p) => p.groupId === scope.id) : plan ? [plan] : [];
  const f = figures(shown);
  const u = unit(shown);
  const ids = new Set(shown.map((p) => p.id));
  const bought = purchases.filter((p) => ids.has(p.planId));
  const [renaming, setRenaming] = useState<string | null>(scope.kind === "group" && scope.rename && group ? group.name : null);
  const [renameProblem, setRenameProblem] = useState<string | null>(null);

  if ((scope.kind === "group" && !group) || (scope.kind === "plan" && !plan)) {
    return (
      <main className="wlv-pane wlv-sheet dcv-sheet">
        <div className="dcv-empty">
          <b>{scope.kind === "group" ? "This group is gone." : "This plan is gone."}</b>
          <button type="button" className="dcv-button" onClick={() => onScope({ kind: "all" })}>
            Back to all plans
          </button>
        </div>
      </main>
    );
  }

  const base = plan?.symbol.split("/")[0];
  const quote = plan?.symbol.split("/")[1];
  const badge = plan ? badgeOf(plan, accounts) : null;
  const next = nextDue(shown);
  const active = shown.filter((p) => p.status === "active").length;

  const rename = async () => {
    if (!group || renaming === null) return;
    const p = await props.onRenameGroup(group.id, renaming);
    setRenameProblem(p);
    if (!p) setRenaming(null);
  };

  return (
    <main className="wlv-pane wlv-sheet dcv-sheet">
      <header className="wlv-head">
        <div className="wlv-title-block">
          {group && renaming !== null ? (
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
              <span className="pv-ink">{scope.kind === "all" ? "All plans" : group ? group.name : `${base} · ${plan!.quoteAmount} ${quote}`}</span>
            </h2>
          )}
          <p className="wlv-sheet-sub">
            {scope.kind === "all"
              ? plans.length
                ? `${plans.length} plan${plans.length === 1 ? "" : "s"}${groups.length ? ` · ${groups.length} group${groups.length === 1 ? "" : "s"}` : ""} · purchases run while the app is open`
                : "Buy the same amount at regular intervals — in the paper portfolio, or on an exchange account with your confirmation each time."
              : group
                ? `${shown.length} plan${shown.length === 1 ? "" : "s"} in this group`
                : `${frequencyWords(plan!.frequency)} · ${plan!.destination === "paper" ? "paper portfolio, automatic" : `${accounts.find((a) => a.id === plan!.accountId)?.label ?? "a removed account"}, each purchase confirmed by you`}${plan!.status !== "active" ? ` · ${plan!.status}` : ""}`}
          </p>
        </div>
        {status && <span className="wlv-status">{status}</span>}
        {group && renaming === null && (
          <>
            <button type="button" className="wlv-icon" onClick={() => setRenaming(group.name)} aria-label="Rename the group" title="Rename">
              <Pencil />
            </button>
            <button type="button" className="wlv-icon" onClick={() => props.onDeleteGroup(group.id)} aria-label="Delete the group" title="Delete the group — its plans are kept">
              <Trash />
            </button>
          </>
        )}
        {plan && (
          <>
            {plan.status !== "ended" && (
              <button type="button" className="dcv-button" onClick={() => props.onPlan(plan.id, plan.status === "paused" ? "resume" : "pause")}>
                {plan.status === "paused" ? "Resume" : "Pause"}
              </button>
            )}
            <button type="button" className="wlv-icon" onClick={() => props.onDeletePlan(plan.id)} aria-label="Delete the plan" title="Delete the plan">
              <Trash />
            </button>
          </>
        )}
        <button type="button" className="wlv-icon" onClick={onReload} aria-label="Read again" title="Read again">
          <Refresh />
        </button>
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}

      <div className="wlv-body dcv-body">
        {scope.kind === "all" && plans.length === 0 ? (
          <div className="dcv-empty">
            <b>No recurring purchase yet.</b>
            <span>Create a plan, or a group to gather several — or ask an agent: “buy 50 USDT of ETH every Monday in paper”.</span>
            <button type="button" className="dcv-button is-primary" onClick={() => onScope({ kind: "new" })}>
              New plan
            </button>
          </div>
        ) : (
          <>
            {/* What it is worth, against what went in. */}
            <div className="dcv-hero">
              <p className="dcv-hero-value">
                <span>{f.value !== undefined ? fmt(f.value, 2) : fmt(f.invested, 2)}</span>
                <small>{u}</small>
              </p>
              {f.pct !== undefined && (
                <p className="dcv-hero-move">
                  <b className={`wlv-pill ${toneOf(f.pct)}`}>{pct(f.pct)}</b>
                  <span>
                    {signedMoney(f.pnl, u)} on {money(f.invested, u)} invested
                  </span>
                </p>
              )}
              {f.pct === undefined && <p className="dcv-hero-move">{f.purchases ? "Reading the current prices…" : "Nothing bought yet."}</p>}
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
                    <Metric label="Group" value={groups.find((g) => g.id === plan.groupId)?.name ?? "None"} sub="changed under Settings, below" />
                  </>
                ) : (
                  <>
                    <Metric label="Plans" value={`${shown.length}`} sub={`${active} active${shown.length - active ? ` · ${shown.length - active} paused or ended` : ""}`} />
                    <Metric label="Next purchase" value={when(next)} sub={next ? (shown.find((p) => p.nextDue === next)?.symbol ?? "") : "none planned"} />
                    <Metric label="Pending" value={`${f.pending}`} sub="real purchases awaiting your click" />
                  </>
                )}
              </div>
            </Part>

            {plan && (
              <Part title="Settings" sub="where it buys, and in which group it is listed">
                <div className="dcv-settings">
                  <div className="dcv-setting">
                    <span className="dcv-caption">Group</span>
                    <Select id="dca-plan-group" label="Group" value={plan.groupId ?? ""} options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} onChange={(v) => props.onMove(plan.id, v || null)} />
                  </div>
                  <div className="dcv-setting">
                    <span className="dcv-caption">Buys on</span>
                    <b>{plan.destination === "paper" ? "Paper portfolio — simulated, automatic" : `${accounts.find((a) => a.id === plan.accountId)?.label ?? "a removed account"} — proposed, confirmed by you`}</b>
                  </div>
                  <div className="dcv-setting">
                    <span className="dcv-caption">Started</span>
                    <b>{when(plan.startAt)}</b>
                  </div>
                  {plan.endAt && (
                    <div className="dcv-setting">
                      <span className="dcv-caption">Ends</span>
                      <b>{when(plan.endAt)}</b>
                    </div>
                  )}
                </div>
              </Part>
            )}

            {!plan && (
              <Part title="Plans" sub={group ? "the plans of this group" : "every plan, and the group it is listed under"}>
                <div className="dcv-plans">
                  {shown.map((p) => {
                    const pf = figures([p]);
                    const b = badgeOf(p, accounts);
                    const g = groups.find((x) => x.id === p.groupId);
                    return (
                      <button key={p.id} type="button" className={`dcv-plan${p.status !== "active" ? " is-idle" : ""}`} onClick={() => onScope({ kind: "plan", id: p.id })}>
                        <span className="dcv-plan-name">
                          <span className="dcv-item-top">
                            <b>{p.symbol.split("/")[0]}</b>
                            <span className={badgeClass(b)}>{b}</span>
                            {p.status !== "active" && <span className="dcv-state">{p.status}</span>}
                          </span>
                          <small>
                            {p.quoteAmount} {p.symbol.split("/")[1]} · {frequencyWords(p.frequency)}
                            {!group && g ? ` · ${g.name}` : ""}
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
                  {group && (
                    <button type="button" className="dcv-plan dcv-plan-add" onClick={() => onScope({ kind: "new", groupId: group.id })}>
                      <Plus />
                      Add a plan to this group
                    </button>
                  )}
                </div>
              </Part>
            )}

            <Part title="Purchases" sub={bought.length ? `${bought.filter((p) => p.status === "filled").length} bought · ${bought.filter((p) => p.status === "proposed").length} awaiting your confirmation` : "none yet"}>
              {bought.length === 0 ? (
                <p className="dcv-quiet">{shown.some((p) => p.status === "active") ? `The first one is due ${when(next)}.` : "No purchase, and nothing planned."}</p>
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
