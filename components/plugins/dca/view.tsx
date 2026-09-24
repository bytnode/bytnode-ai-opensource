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
import { Pencil, Plus, Trash } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { act, usePluginData, viewTransport } from "../use-plugin-data";
import { useAwakeInterval, useOnWake } from "../view-activity";
import { ConfigHead, DcaConfig } from "./config";
import { ItemMenu, useItemMenu, type MenuItem } from "./menu";
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
  /* The configuration saved: a new DCA, or a DCA changed — then shown. */
  const saveConfig = async (input: Record<string, unknown>) => {
    try {
      const saved = await callPlugin<{ id: string }>("dca", typeof input.id === "string" ? "edit" : "create", input, viewTransport(settings));
      state.reload();
      prices.reload();
      curve.reload();
      setProblem(null);
      setScope({ kind: "plan", id: saved.id });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  /* A group's right click. */
  const menuItems = (): MenuItem[] => {
    const at = menu.at;
    if (!at) return [];
    return [
      { label: "Add a DCA", icon: <Plus />, onSelect: () => setScope({ kind: "config", groupId: at.id }) },
      { label: "Rename", icon: <Pencil />, onSelect: () => setScope({ kind: "group", id: at.id, rename: true }) },
      { label: "Delete the group", icon: <Trash />, danger: true, onSelect: () => setConfirm({ kind: "group", id: at.id }) },
    ];
  };

  const status = curve.loading && curve.data ? "Updating…" : "";
  const confirmedPlan = confirm?.kind === "plan" ? plans.find((p) => p.id === confirm.id) : undefined;
  const confirmedGroup = confirm?.kind === "group" ? groups?.find((g) => g.id === confirm.id) : undefined;
  const configured = scope?.kind === "config" && scope.planId ? plans.find((p) => p.id === scope.planId) : undefined;
  const closeConfig = () => setScope(configured ? { kind: "plan", id: configured.id } : openGroup ? { kind: "group", id: openGroup } : null);

  return (
    <div className="wlv dcv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.dcaWidth}px` } as CSSProperties}>
        <Side groups={groups} plans={plans} figures={figures} unit={unit} open={openGroup ?? null} onOpen={(id) => setScope({ kind: "group", id })} onMenu={(e, id) => menu.open(e, { kind: "group", id })} onCreateGroup={createGroup} />
        <ColumnHandle panel={panel} cssVar="--wlv-list" width={ui.dcaWidth} min={DCA_MIN} max={DCA_MAX} reset={DCA_DEFAULT} clamp={clampDcaWidth} onCommit={(w) => updateUiPrefs({ dcaWidth: w })} label="Width of the groups column" />
        {scope?.kind === "config" && groups ? (
          <main className="wlv-pane wlv-sheet dcv-sheet">
            <ConfigHead title={configured ? `Configure ${planTitle(configured)}` : "New DCA"} sub={configured ? "Change its amount, its schedule, its end, its group or its name." : `In ${groups.find((g) => g.id === scope.groupId)?.name ?? "a group"} — every setting, and what it will do.`} onClose={closeConfig} />
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
            <div className="dcv-empty">{state.error ? <b>{state.error}</b> : groups ? <span>Make a group in the column to hold your DCAs.</span> : <span>Reading your DCAs…</span>}</div>
          </main>
        )}
      </div>
      {menu.at && <ItemMenu at={menu.at} label="Group actions" items={menuItems()} onClose={menu.close} />}
      {confirmedPlan && (
        <ConfirmDialog
          title={`Delete ${planTitle(confirmedPlan)}?`}
          body="The DCA stops and is removed with its history. What it bought stays where it is — in the paper portfolio or on the exchange; nothing is sold."
          confirmLabel="Delete"
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
          title={`Delete the group "${confirmedGroup.name}"?`}
          body={(() => {
            const n = plans.filter((p) => p.groupId === confirmedGroup.id).length;
            return n ? `Its ${n} DCA${n === 1 ? "" : "s"} stop and are deleted with it. What they bought stays where it is — nothing is sold.` : "The group is empty: nothing else is touched.";
          })()}
          confirmLabel="Delete the group"
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
