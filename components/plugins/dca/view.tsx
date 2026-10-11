"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import type { Purchase } from "@/lib/plugins/dca/plans";
import { planFigures, sumFigures, unitOf, type PlanRow } from "@/lib/plugins/dca/view-model";
import type { Candle } from "@/lib/plugins/shared/candle";
import type { Listed } from "@/lib/plugins/shared/prices";
import { callPlugin } from "@/lib/plugins/client";
import { DCA_DEFAULT, DCA_MAX, DCA_MIN, clampDcaWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { useMessages } from "@/lib/i18n/react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Pencil, Plus, Trash } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { act, usePluginData, viewTransport } from "../use-plugin-data";
import { useAwakeInterval, useOnWake } from "../view-activity";
import { ConfigHead, DcaConfig } from "./config";
import { ItemMenu, useItemMenu, type MenuItem } from "../item-menu";
import { Sheet, planTitle, type Shown } from "./sheet";
import { Side } from "./side";
import "../watchlist/watchlist.css";
import "../paper-trading/paper-trading.css";
import "./dca.css";

/* ---------------------------------------------------------------------------
   The DCA tab, in the bare views' language (the veil and the sheet of the
   watchlist, the tiles of the portfolio). Left, the groups — and only them.
   Right, the group open (an empty one only offers to add a DCA), or one of
   its DCAs, or a DCA's configuration, opened at once (`./config.tsx`) to
   make one or to change it.

   The DCAs are read every 15 s while the tab is in front (a purchase may
   have landed), their prices every minute (BytNode's quota), the curve of
   what is open once and when the tab wakes. Nothing here buys: a real
   DCA's purchases wait for the user's click in the notification center.
--------------------------------------------------------------------------- */

/** What is open: a group (`rename`: with its name being edited), a DCA,
    or a configuration — of a new DCA in a group, or of a DCA. */
type Scope = Shown | { kind: "config"; groupId?: string; planId?: string };

type State = { plans: PlanRow[]; groups?: DcaGroup[]; purchases: Purchase[]; paperCash: string };

const REFRESH = 15_000;
const PRICES = 60_000;

export function DcaView({ settings }: ViewProps) {
  const t = useMessages();
  const w = t.dca;
  const state = usePluginData<State>("dca", "state", settings, {}, { keep: "latest" });
  const prices = usePluginData<{ prices: Record<string, number> }>("dca", "prices", settings, {}, { keep: "latest" });
  useAwakeInterval(state.reload, REFRESH);
  useAwakeInterval(prices.reload, PRICES);
  const pairsData = usePluginData<Listed[]>("paper-trading", "pairs", settings, {}, { keep: "latest" });
  useOnWake(pairsData.reload);

  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const accounts = settings.keys.exchanges;
  const [picked, setScope] = useState<Scope | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "plan" | "group"; id: string } | null>(null);
  const menu = useItemMenu();

  const plans = state.data?.plans ?? [];
  const groups = state.data ? (state.data.groups ?? []) : null;
  const purchases = state.data?.purchases ?? [];
  const priceOf = prices.data?.prices ?? {};
  const figures = (list: PlanRow[]) => (list.length === 1 ? planFigures(list[0], priceOf[list[0].symbol]) : sumFigures(list.map((p) => planFigures(p, priceOf[p.symbol]))));
  const unit = (list: PlanRow[]) => unitOf(list);

  /* What is open: the choice while it still exists, else the first group. */
  const valid = (s: Scope | null): s is Scope =>
    !!s && (s.kind === "group" ? !!groups?.some((g) => g.id === s.id) : s.kind === "plan" ? plans.some((p) => p.id === s.id) : s.planId ? plans.some((p) => p.id === s.planId) : !!groups?.length);
  const scope: Scope | null = valid(picked) ? picked : groups?.length ? { kind: "group", id: groups[0].id } : null;
  const openGroup = scope?.kind === "group" ? scope.id : scope?.kind === "plan" ? plans.find((p) => p.id === scope.id)?.groupId : scope?.kind === "config" ? (scope.groupId ?? plans.find((p) => p.id === scope.planId)?.groupId) : undefined;

  /* The curve of what is open: the DCAs it holds. */
  const shownPlans = scope?.kind === "group" ? plans.filter((p) => p.groupId === scope.id) : scope?.kind === "plan" ? plans.filter((p) => p.id === scope.id) : [];
  const curve = usePluginData<{ series: Candle[] }>("dca", "curve", settings, { plans: shownPlans.map((p) => p.id).sort() }, { keep: "exact" });
  useOnWake(curve.reload);
  const series = curve.data ? curve.data.series : curve.loading ? null : [];

  const pairs = Array.isArray(pairsData.data) && pairsData.data.length ? pairsData.data : null;
  const pairsUnavailable = !settings.keys.bytnode.trim() ? w.pairsNeedKey : pairsData.data && !pairs ? w.pairsUnreadable : null;

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
  /* The configuration saved: a new DCA, or a DCA changed. */
  const saveConfig = async (input: Record<string, unknown>) => {
    try {
      const saved = await callPlugin<{ id: string; groupId?: string }>("dca", typeof input.id === "string" ? "edit" : "create", input, viewTransport(settings));
      state.reload();
      prices.reload();
      curve.reload();
      setProblem(null);
      /* A new DCA: back to its group, where it is listed; a DCA changed: itself. */
      setScope(typeof input.id === "string" ? { kind: "plan", id: saved.id } : saved.groupId ? { kind: "group", id: saved.groupId } : null);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  /* A right click: on a DCA, or on a group. */
  const menuItems = (): MenuItem[] => {
    const at = menu.at;
    if (!at) return [];
    if (at.kind === "plan")
      return [
        { label: w.editPlan, icon: <Pencil />, onSelect: () => setScope({ kind: "config", planId: at.id }) },
        { label: w.deletePlan, icon: <Trash />, danger: true, onSelect: () => setConfirm({ kind: "plan", id: at.id }) },
      ];
    return [
      { label: w.addPlan, icon: <Plus />, onSelect: () => setScope({ kind: "config", groupId: at.id }) },
      { label: t.common.rename, icon: <Pencil />, onSelect: () => setScope({ kind: "group", id: at.id, rename: true }) },
      { label: w.deleteGroup, icon: <Trash />, danger: true, onSelect: () => setConfirm({ kind: "group", id: at.id }) },
    ];
  };

  const status = curve.loading && curve.data ? w.updating : "";
  const confirmedPlan = confirm?.kind === "plan" ? plans.find((p) => p.id === confirm.id) : undefined;
  const confirmedGroup = confirm?.kind === "group" ? groups?.find((g) => g.id === confirm.id) : undefined;
  const configured = scope?.kind === "config" && scope.planId ? plans.find((p) => p.id === scope.planId) : undefined;
  const closeConfig = () => setScope(configured ? { kind: "plan", id: configured.id } : openGroup ? { kind: "group", id: openGroup } : null);

  return (
    <div className="wlv dcv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.dcaWidth}px` } as CSSProperties}>
        <Side groups={groups} plans={plans} figures={figures} unit={unit} accounts={accounts} open={openGroup ?? null} openPlan={scope?.kind === "plan" ? scope.id : null} onOpen={(id) => setScope({ kind: "group", id })} onPlan={(id) => setScope({ kind: "plan", id })} onMenu={(e, id) => menu.open(e, { kind: "group", id })} onPlanMenu={(e, id) => menu.open(e, { kind: "plan", id })} onCreateGroup={createGroup} />
        <ColumnHandle panel={panel} cssVar="--wlv-list" width={ui.dcaWidth} min={DCA_MIN} max={DCA_MAX} reset={DCA_DEFAULT} clamp={clampDcaWidth} onCommit={(w) => updateUiPrefs({ dcaWidth: w })} label={w.columnWidth} />
        {scope?.kind === "config" && groups ? (
          <main className="wlv-pane wlv-sheet dcv-sheet">
            <ConfigHead
              title={configured ? w.configureTitle(planTitle(configured)) : w.newPlan}
              sub={(() => {
                const name = groups.find((g) => g.id === (configured ? configured.groupId : scope.groupId))?.name;
                return name ? w.inGroup(name) : configured ? w.inItsGroup : w.inAGroup;
              })()}
              onClose={closeConfig}
            />
            <div className="wlv-body dcv-body">
              <DcaConfig key={configured?.id ?? `new:${scope.groupId ?? ""}`} settings={settings} plan={configured} groups={groups} accounts={accounts} pairs={pairs} pairsUnavailable={pairsUnavailable} paperCash={state.data?.paperCash ?? "USDT"} groupId={scope.groupId} onSave={saveConfig} onCancel={closeConfig} />
            </div>
          </main>
        ) : scope && scope.kind !== "config" && groups ? (
          <Sheet
            key={`${scope.kind}:${scope.id}${scope.kind === "group" && scope.rename ? ":rename" : ""}`}
            shown={scope}
            plans={plans}
            groups={groups}
            purchases={purchases}
            accounts={accounts}
            figures={figures}
            unit={unit}
            series={series}
            status={status}
            problem={problem ?? state.error ?? null}
            onReload={reload}
            onGroup={(id) => setScope({ kind: "group", id })}
            onPlan={(id) => setScope({ kind: "plan", id })}
            onConfigure={(t) => setScope("planId" in t ? { kind: "config", planId: t.planId } : { kind: "config", groupId: t.groupId })}
            onPause={(id, action) => void run("update", { id, action })}
            onDeletePlan={(id) => setConfirm({ kind: "plan", id })}
            onRenameGroup={(id, name) => run("group", { action: "rename", id, name })}
            onDeleteGroup={(id) => setConfirm({ kind: "group", id })}
          />
        ) : (
          <main className="wlv-pane wlv-sheet dcv-sheet">
            <div className="dcv-empty">{state.error ? <b>{state.error}</b> : groups ? <span>{w.emptyMakeGroup}</span> : <span>{w.reading}</span>}</div>
          </main>
        )}
      </div>
      {menu.at && <ItemMenu at={menu.at} label={menu.at.kind === "plan" ? w.planActions : w.groupActions} items={menuItems()} onClose={menu.close} />}
      {confirmedPlan && (
        <ConfirmDialog
          title={w.deletePlanTitle(planTitle(confirmedPlan))}
          body={w.deletePlanBody}
          confirmLabel={t.common.delete}
          onConfirm={() => {
            const id = confirmedPlan.id;
            const home = confirmedPlan.groupId;
            setConfirm(null);
            void run("update", { id, action: "delete" }).then((p) => !p && home && setScope({ kind: "group", id: home }));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirmedGroup && (
        <ConfirmDialog
          title={w.deleteGroupTitle(confirmedGroup.name)}
          body={w.deleteGroupBody(plans.filter((p) => p.groupId === confirmedGroup.id).length)}
          confirmLabel={w.deleteGroup}
          onConfirm={() => {
            const id = confirmedGroup.id;
            setConfirm(null);
            void run("group", { action: "delete", id }).then((p) => !p && setScope(null));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
