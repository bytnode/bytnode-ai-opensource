"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import type { Purchase } from "@/lib/plugins/dca/plans";
import { planFigures, sumFigures, unitOf, type PlanRow } from "@/lib/plugins/dca/view-model";
import type { Candle } from "@/lib/plugins/shared/candle";
import type { Listed } from "@/lib/plugins/shared/prices";
import { callPlugin } from "@/lib/plugins/client";
import { DCA_DEFAULT, DCA_MAX, DCA_MIN, clampDcaWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Folder, Pencil, Trash } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { act, usePluginData, viewTransport } from "../use-plugin-data";
import { useAwakeInterval, useOnWake } from "../view-activity";
import { ItemMenu, useItemMenu, type MenuItem } from "./menu";
import { NewPlan } from "./new-plan";
import { Sheet } from "./sheet";
import { Side } from "./side";
import "../watchlist/watchlist.css";
import "../paper-trading/paper-trading.css";
import "./dca.css";

/* ---------------------------------------------------------------------------
   The DCA tab, in the bare views' language (the veil and the sheet of the
   watchlist, the tiles of the portfolio). Left, the plans' column: "All
   plans", the groups — a project whose plans open in the sheet, not in the
   column — and the plans in no group. Right, what is open (`./sheet.tsx`),
   or a new plan (`./new-plan.tsx`).

   The plans are read every 15 s while the tab is in front (a purchase may
   have landed), their prices every minute (BytNode's quota), the curve of
   what is open once and when the tab wakes. Nothing here buys: a real
   plan's purchases wait for the user's click in the notification center.
--------------------------------------------------------------------------- */

/** What is open: `rename` opens a group with its name being edited. */
export type Scope = { kind: "all" } | { kind: "group"; id: string; rename?: boolean } | { kind: "plan"; id: string } | { kind: "new"; groupId?: string };

type State = { plans: PlanRow[]; groups?: DcaGroup[]; purchases: Purchase[]; paperCash: string };

const REFRESH = 15_000;
const PRICES = 60_000;

export function DcaView({ settings }: ViewProps) {
  const state = usePluginData<State>("dca", "state", settings, {}, { keep: "latest" });
  const prices = usePluginData<{ prices: Record<string, number> }>("dca", "prices", settings, {}, { keep: "latest" });
  useAwakeInterval(state.reload, REFRESH);
  useAwakeInterval(prices.reload, PRICES);
  const pairsData = usePluginData<Listed[]>("paper-trading", "pairs", settings, {}, { keep: "latest" });
  useOnWake(pairsData.reload);

  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const accounts = settings.keys.exchanges;
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "plan" | "group"; id: string } | null>(null);
  const menu = useItemMenu();

  const plans = state.data?.plans ?? null;
  const groups = state.data?.groups ?? [];
  const purchases = state.data?.purchases ?? [];
  const priceOf = prices.data?.prices ?? {};
  const figures = (list: PlanRow[]) => sumFigures(list.map((p) => planFigures(p, priceOf[p.symbol])));
  const plan1 = (list: PlanRow[]) => (list.length === 1 ? planFigures(list[0], priceOf[list[0].symbol]) : figures(list));
  const unit = (list: PlanRow[]) => unitOf(list);

  /* The curve of what is open: the plans it holds. */
  const open = scope.kind === "all" ? (plans ?? []) : scope.kind === "group" ? (plans ?? []).filter((p) => p.groupId === scope.id) : scope.kind === "plan" ? (plans ?? []).filter((p) => p.id === scope.id) : [];
  const curve = usePluginData<{ series: Candle[] }>("dca", "curve", settings, { plans: open.map((p) => p.id).sort() }, { keep: "exact" });
  useOnWake(curve.reload);
  const series = curve.data ? curve.data.series : curve.loading ? null : [];

  const pairs = Array.isArray(pairsData.data) && pairsData.data.length ? pairsData.data : null;
  const pairsUnavailable = !settings.keys.bytnode.trim() ? "The list of pairs comes from BytNode: add your key in Settings → Auth." : pairsData.data && !pairs ? "BytNode's list of pairs could not be read — type a pair." : null;

  const reload = () => {
    state.reload();
    prices.reload();
    curve.reload();
  };
  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("dca", action, params, settings);
    setProblem(p);
    state.reload();
    return p;
  };
  const createGroup = async (name: string) => {
    try {
      const g = await callPlugin<DcaGroup>("dca", "group", { action: "create", name }, viewTransport(settings));
      state.reload();
      setScope({ kind: "group", id: g.id });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  const createPlan = async (input: Record<string, unknown>) => {
    try {
      const made = await callPlugin<{ id: string }>("dca", "create", input, viewTransport(settings));
      state.reload();
      prices.reload();
      setScope({ kind: "plan", id: made.id });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  /* The right click's items. */
  const menuItems = (): MenuItem[] => {
    const at = menu.at;
    if (!at) return [];
    if (at.kind === "group") {
      return [
        { label: "Open", icon: <Folder />, onSelect: () => setScope({ kind: "group", id: at.id }) },
        { label: "Rename", icon: <Pencil />, onSelect: () => setScope({ kind: "group", id: at.id, rename: true }) },
        { label: "Delete the group", icon: <Trash />, danger: true, onSelect: () => setConfirm({ kind: "group", id: at.id }) },
      ];
    }
    const p = plans?.find((x) => x.id === at.id);
    if (!p) return [];
    return [
      ...groups.filter((g) => g.id !== p.groupId).map((g) => ({ label: `Move to ${g.name}`, icon: <Folder />, onSelect: () => void run("move", { id: p.id, groupId: g.id }) })),
      ...(p.groupId ? [{ label: "Take out of its group", onSelect: () => void run("move", { id: p.id, groupId: null }) }] : []),
      ...(p.status !== "ended" ? [{ label: p.status === "paused" ? "Resume" : "Pause", onSelect: () => void run("update", { id: p.id, action: p.status === "paused" ? "resume" : "pause" }) }] : []),
      { label: "Delete the plan", icon: <Trash />, danger: true, onSelect: () => setConfirm({ kind: "plan", id: p.id }) },
    ];
  };

  const status = curve.loading && curve.data ? "Updating…" : "";
  const confirmedPlan = confirm?.kind === "plan" ? plans?.find((p) => p.id === confirm.id) : undefined;
  const confirmedGroup = confirm?.kind === "group" ? groups.find((g) => g.id === confirm.id) : undefined;

  return (
    <div className="wlv dcv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.dcaWidth}px` } as CSSProperties}>
        <Side plans={plans} groups={groups} accounts={accounts} figures={plan1} unit={unit} scope={scope} onScope={setScope} onMenu={menu.open} onCreateGroup={createGroup} />
        <ColumnHandle panel={panel} cssVar="--wlv-list" width={ui.dcaWidth} min={DCA_MIN} max={DCA_MAX} reset={DCA_DEFAULT} clamp={clampDcaWidth} onCommit={(w) => updateUiPrefs({ dcaWidth: w })} label="Width of the plans column" />
        {scope.kind === "new" ? (
          <main className="wlv-pane wlv-sheet dcv-sheet">
            <header className="wlv-head">
              <div className="wlv-title-block">
                <h2 className="wlv-sheet-title">
                  <span className="pv-ink">New plan</span>
                </h2>
                <p className="wlv-sheet-sub">The same amount, bought at regular intervals.</p>
              </div>
            </header>
            <div className="wlv-body dcv-body">
              <NewPlan key={scope.groupId ?? ""} groups={groups} accounts={accounts} pairs={pairs} pairsUnavailable={pairsUnavailable} paperCash={state.data?.paperCash ?? "USDT"} groupId={scope.groupId} onCreate={createPlan} onCancel={() => setScope(scope.groupId ? { kind: "group", id: scope.groupId } : { kind: "all" })} />
            </div>
          </main>
        ) : plans === null ? (
          <main className="wlv-pane wlv-sheet dcv-sheet">
            <div className="dcv-empty">{state.error ? <b>{state.error}</b> : <span>Reading your plans…</span>}</div>
          </main>
        ) : (
          <Sheet
            key={scope.kind === "all" ? "all" : `${scope.kind}:${scope.id}${scope.kind === "group" && scope.rename ? ":rename" : ""}`}
            scope={scope}
            plans={plans}
            groups={groups}
            purchases={purchases}
            accounts={accounts}
            figures={plan1}
            unit={unit}
            series={series}
            status={status}
            problem={problem ?? state.error ?? null}
            onReload={reload}
            onScope={setScope}
            onPlan={(id, action) => void run("update", { id, action })}
            onMove={(id, groupId) => void run("move", { id, groupId })}
            onDeletePlan={(id) => setConfirm({ kind: "plan", id })}
            onRenameGroup={(id, name) => run("group", { action: "rename", id, name })}
            onDeleteGroup={(id) => setConfirm({ kind: "group", id })}
          />
        )}
      </div>
      {menu.at && <ItemMenu at={menu.at} label={menu.at.kind === "group" ? "Group actions" : "Plan actions"} items={menuItems()} onClose={menu.close} />}
      {confirmedPlan && (
        <ConfirmDialog
          title={`Delete the ${confirmedPlan.symbol} plan?`}
          body="The plan stops and is removed with its history. What it bought stays where it is — in the paper portfolio or on the exchange; nothing is sold."
          confirmLabel="Delete"
          onConfirm={() => {
            const id = confirmedPlan.id;
            setConfirm(null);
            void run("update", { id, action: "delete" }).then((p) => !p && scope.kind === "plan" && scope.id === id && setScope({ kind: "all" }));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirmedGroup && (
        <ConfirmDialog
          title={`Delete the group "${confirmedGroup.name}"?`}
          body="Only the group goes: its plans keep running, listed on their own in the column."
          confirmLabel="Delete the group"
          onConfirm={() => {
            const id = confirmedGroup.id;
            setConfirm(null);
            void run("group", { action: "delete", id }).then((p) => !p && scope.kind === "group" && scope.id === id && setScope({ kind: "all" }));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
