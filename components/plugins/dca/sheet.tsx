"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import type { Purchase } from "@/lib/plugins/dca/plans";
import { frequencyPhrase, frequencyWords, nextDue, type Figures, type PlanRow } from "@/lib/plugins/dca/view-model";
import { useMessages } from "@/lib/i18n/react";
import type { Messages } from "@/lib/i18n/messages/en";
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

const STATUS_TONE: Record<Purchase["status"], string> = { filled: "var(--dca-accent)", proposed: "var(--cal-unlock)", refused: "var(--down)", expired: "var(--down)", failed: "var(--down)", skipped: "rgba(var(--ink), 0.35)" };
const SHOWN = 30;

/** What a DCA is called: its name, else its pair and amount. */
export const planTitle = (p: PlanRow) => p.name ?? `${p.symbol.split("/")[0]} · ${p.quoteAmount} ${p.symbol.split("/")[1]}`;

export function Sheet(props: Props) {
  const { shown, plans, groups, purchases, accounts, figures, unit, series, status, problem, onReload, onGroup, onPlan, onConfigure } = props;
  const t = useMessages();
  const w = t.dca.sheet;
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
          <b>{shown.kind === "plan" ? w.planGone : w.groupGone}</b>
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
    if (!renaming.trim()) return setRenameProblem(t.dca.side.nameIt);
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
              <input className="wlv-input" aria-label={w.groupName} value={renaming} autoFocus maxLength={40} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
              <button type="submit" className="dcv-button is-primary">
                {t.common.save}
              </button>
              <button type="button" className="dcv-button" onClick={() => setRenaming(null)}>
                {t.common.cancel}
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
                {` · ${plan.symbol} · ${frequencyPhrase(plan.frequency)} · ${plan.destination === "paper" ? w.paperAutomatic : w.accountConfirmed(accounts.find((a) => a.id === plan.accountId)?.label ?? w.removedAccount)}${plan.status !== "active" ? ` · ${t.dca.status[plan.status]}` : ""}`}
              </>
            ) : empty ? (
              t.dca.side.noPlanYet
            ) : (
              w.groupSub(inside.length)
            )}
          </p>
        </div>
        {status && <span className="wlv-status">{status}</span>}
        {!plan && renaming === null && (
          <>
            {!empty && (
              <button type="button" className="dcv-button is-primary" onClick={() => onConfigure({ groupId: group.id })}>
                <Plus />
                {t.dca.addPlan}
              </button>
            )}
            <button type="button" className="wlv-icon" onClick={() => setRenaming(group.name)} aria-label={w.renameGroup} title={t.common.rename}>
              <Pencil />
            </button>
            <button type="button" className="wlv-icon" onClick={() => props.onDeleteGroup(group.id)} aria-label={t.dca.deleteGroup} title={w.deleteGroupHint}>
              <Trash />
            </button>
          </>
        )}
        {plan && (
          <>
            <button type="button" className="dcv-button is-primary" onClick={() => onConfigure({ planId: plan.id })}>
              <Gear />
              {w.configure}
            </button>
            {plan.status !== "ended" && (
              <button type="button" className="dcv-button" onClick={() => props.onPause(plan.id, plan.status === "paused" ? "resume" : "pause")}>
                {plan.status === "paused" ? w.resume : w.pause}
              </button>
            )}
            <button type="button" className="wlv-icon" onClick={() => props.onDeletePlan(plan.id)} aria-label={t.dca.deletePlan} title={t.dca.deletePlan}>
              <Trash />
            </button>
          </>
        )}
        {!empty && (
          <button type="button" className="wlv-icon" onClick={onReload} aria-label={w.readAgain} title={w.readAgain}>
            <Refresh />
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}

      <div className="wlv-body dcv-body">
        {empty ? (
          /* An empty group: a quiet invitation. */
          <div className="dcv-start">
            <p>{w.startHint}</p>
            <button type="button" className="dcv-button is-primary dcv-start-button" onClick={() => onConfigure({ groupId: group.id })}>
              <Plus />
              {t.dca.addPlan}
            </button>
          </div>
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
                    {w.pnlOn(signedMoney(f.pnl, u), money(f.invested, u))}
                  </span>
                </p>
              ) : (
                <p className="dcv-hero-move">{f.purchases ? w.readingPrices : nothingYet(t, bought, next ? when(next) : null)}</p>
              )}
            </div>

            <Part title={w.valueTitle} sub={w.valueSub}>
              <div className="dcv-chart">
                <PriceChart candles={series ?? []} interval="1d" mode="line" fit returns message={series === null ? w.chartReading : series.length < 2 ? w.chartStarts : null} />
              </div>
              <div className="wlv-insights dcv-metrics" style={{ "--cols": plan ? 4 : 3 } as CSSProperties}>
                <Metric label={w.invested} value={money(f.invested, u)} sub={w.purchases(f.purchases, f.pending)} />
                <Metric label={w.value} value={money(f.value, u)} sub={w.atCurrentPrice} />
                <Metric label={w.result} value={signedMoney(f.pnl, u)} tone={toneOf(f.pnl)} sub={f.pct !== undefined ? pct(f.pct) : "—"} />
                {plan ? (
                  <>
                    <Metric label={w.bought} value={f.amount ? `${fmt(f.amount)} ${base}` : "—"} sub={w.eachTime(`${plan.quoteAmount} ${quote}`)} />
                    <Metric label={w.averagePrice} value={f.average !== undefined ? `${fmt(f.average)} ${quote}` : "—"} sub={w.feesApart} />
                    <Metric label={w.currentPrice} value={f.price !== undefined ? `${fmt(f.price)} ${quote}` : "—"} tone={f.price !== undefined && f.average !== undefined ? toneOf(f.price - f.average) : undefined} sub={f.price !== undefined && f.average !== undefined ? w.fromAverage(pct(((f.price - f.average) / f.average) * 100)) : "—"} />
                    <Metric label={w.nextPurchase} value={plan.status === "active" ? when(plan.nextDue) : t.dca.status[plan.status]} sub={frequencyWords(plan.frequency)} />
                    <Metric label={w.ends} value={plan.endAt ? when(plan.endAt) : w.never} sub={plan.endAt ? w.thenStops : w.untilPaused} />
                  </>
                ) : (
                  <>
                    <Metric label={w.plansMetric} value={`${inside.length}`} sub={w.activeCount(active, inside.length - active)} />
                    <Metric label={w.nextPurchase} value={when(next)} sub={next ? (inside.find((p) => p.nextDue === next)?.symbol ?? "") : w.nonePlanned} />
                    <Metric label={w.pending} value={`${f.pending}`} sub={w.pendingSub} />
                  </>
                )}
              </div>
            </Part>

            {!plan && (
              <Part title={w.plansTitle} sub={w.plansSub}>
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
                            {p.status !== "active" && <span className="dcv-state">{t.dca.status[p.status]}</span>}
                          </span>
                          <small>
                            {p.name ? `${w.amountOf(`${p.quoteAmount} ${p.symbol.split("/")[1]}`, p.symbol.split("/")[0])} · ` : ""}
                            {frequencyWords(p.frequency)}
                          </small>
                        </span>
                        <span className="dcv-plan-cell">
                          <small>{w.next}</small>
                          {p.status === "active" ? when(p.nextDue) : "—"}
                        </span>
                        <span className="dcv-plan-cell">
                          <small>{w.invested}</small>
                          {money(pf.invested, p.symbol.split("/")[1])}
                        </span>
                        <span className={`wlv-pill dcv-pill ${toneOf(pf.pct)}`}>{pf.pct !== undefined ? pct(pf.pct) : "—"}</span>
                      </button>
                    );
                  })}
                  <button type="button" className="dcv-plan dcv-plan-add" onClick={() => onConfigure({ groupId: group.id })}>
                    <Plus />
                    {w.addToGroup}
                  </button>
                </div>
              </Part>
            )}

            <Part title={w.purchasesTitle} sub={bought.length ? w.purchasesSub(bought.filter((p) => p.status === "filled").length, bought.filter((p) => p.status === "proposed").length) : w.noneYet}>
              {bought.length === 0 ? (
                <p className="dcv-quiet">{next ? w.firstDue(when(next)) : w.nothingPlanned}</p>
              ) : (
                <div className="dcv-buys">
                  {bought.slice(0, SHOWN).map((u2) => {
                    const p = plans.find((x) => x.id === u2.planId);
                    const b = p?.symbol.split("/")[0] ?? "";
                    return (
                      <div key={u2.id} className="dcv-buy" style={{ "--tone": STATUS_TONE[u2.status] } as CSSProperties}>
                        <span className="dcv-buy-when">{when(u2.at)}</span>
                        <span className="dcv-buy-what">
                          <b>{t.dca.purchase[u2.status]}</b>
                          {u2.status === "filled" && u2.amount !== undefined ? ` ${fmt(u2.amount)} ${b}` : ` ${w.amountOf(`${p?.quoteAmount ?? ""} ${p?.symbol.split("/")[1] ?? ""}`, b)}`}
                          {u2.status === "filled" && u2.price !== undefined ? <small>{w.at(fmt(u2.price))}</small> : null}
                          {u2.late ? <small>{w.missedClosed}</small> : null}
                          {u2.detail && u2.status !== "filled" ? <small> · {u2.detail}</small> : null}
                        </span>
                        <span className={badgeClass(u2.mode === "paper" ? "PAPER" : u2.mode === "testnet" ? "TESTNET" : "LIVE")}>{u2.mode.toUpperCase()}</span>
                      </div>
                    );
                  })}
                  {bought.length > SHOWN && <p className="dcv-quiet dcv-buys-more">{w.earlier(bought.length - SHOWN)}</p>}
                </div>
              )}
            </Part>
          </>
        )}
      </div>
    </main>
  );
}

/** The header before anything was bought: a first attempt that went
    wrong is said, not "the first purchase is due" as if nothing happened. */
function nothingYet(t: Messages, attempts: Purchase[], due: string | null): string {
  const last = attempts.reduce<Purchase | undefined>((a, b) => (!a || b.at > a.at ? b : a), undefined);
  if (!last || last.status === "filled") return t.dca.sheet.nothingYet(due);
  const detail = last.detail ? (last.detail.length > 120 ? `${last.detail.slice(0, 119)}…` : last.detail) : null;
  return t.dca.sheet.lastAttempt(t.dca.purchase[last.status], detail, due);
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
