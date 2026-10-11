"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import { frequencyPhrase, nextDue, type Figures, type PlanRow } from "@/lib/plugins/dca/view-model";
import { useMessages } from "@/lib/i18n/react";
import { ChevronDown, Folder, Plus } from "@/components/ui/icons";
import { badgeClass, badgeOf, money, pct, toneOf, when } from "./format";
import { planTitle } from "./sheet";

/* ---------------------------------------------------------------------------
   The left column: the groups, and nothing else — one block of tiles, as
   the portfolio's. A group says how many DCAs it holds, what went in, when
   the next purchase is and its result; the one open is lit. A right click
   renames or deletes it — on a DCA, edits or deletes that DCA. Its chevron unfolds it in place: its DCAs, one
   row each (badge, next purchase, result), a click opens that DCA straight
   away; a click on the group shown folds or unfolds it, like its chevron. The group open — or the one of the DCA shown — is unfolded unless
   folded by hand. Above the block, "New group" — its name typed in place.
--------------------------------------------------------------------------- */

type Props = {
  groups: DcaGroup[] | null;
  plans: PlanRow[];
  figures: (plans: PlanRow[]) => Figures;
  unit: (plans: PlanRow[]) => string;
  accounts: ExchangeAccount[];
  /** The group open (or the DCA shown's), and the DCA shown. */
  open: string | null;
  openPlan: string | null;
  onOpen: (id: string) => void;
  onPlan: (id: string) => void;
  onMenu: (e: ReactMouseEvent<HTMLElement>, id: string) => void;
  onPlanMenu: (e: ReactMouseEvent<HTMLElement>, id: string) => void;
  /** Makes a group; answers why not, or null. */
  onCreateGroup: (name: string) => Promise<string | null>;
};

export function Side({ groups, plans, figures, unit, accounts, open, openPlan, onOpen, onPlan, onMenu, onPlanMenu, onCreateGroup }: Props) {
  const t = useMessages();
  const w = t.dca.side;
  const [naming, setNaming] = useState(false);
  /* Unfolded by hand, or folded: else the open group is unfolded. */
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const isUnfolded = (id: string) => unfolded[id] ?? id === open;
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return setProblem(w.nameIt);
    setBusy(true);
    const p = await onCreateGroup(name);
    setBusy(false);
    setProblem(p);
    if (!p) {
      setNaming(false);
      setName("");
    }
  };

  return (
    <section className="wlv-pane wlv-side dcv-side" aria-label={w.label}>
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">DCA</span>
        </h2>
        {groups && groups.length > 0 && <span className="wlv-count">{groups.length}</span>}
      </header>

      <div className="dcv-new">
        {naming ? (
          <form
            className="dcv-new-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void create();
            }}
          >
            <input className="wlv-input" aria-label={w.newGroupName} placeholder={w.groupPlaceholder} value={name} autoFocus maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(false)} />
            {problem && <p className="dcv-problem">{problem}</p>}
            <div className="dcv-new-actions">
              <button
                type="button"
                className="dcv-button"
                onClick={() => {
                  setNaming(false);
                  setProblem(null);
                }}
              >
                {t.common.cancel}
              </button>
              <button type="submit" className="dcv-button is-primary" disabled={busy}>
                {busy ? w.creating : w.createGroup}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="dcv-new-open" onClick={() => setNaming(true)}>
            <Plus />
            {w.newGroup}
          </button>
        )}
      </div>

      {groups === null ? (
        <p className="dcv-side-note">{w.readingGroups}</p>
      ) : groups.length === 0 ? (
        <p className="dcv-side-note">{w.noGroup}</p>
      ) : (
        <nav className="dcv-nav" aria-label={w.groups}>
          {groups.map((g) => {
            const inside = plans.filter((p) => p.groupId === g.id);
            const f = figures(inside);
            const on = open === g.id && !openPlan;
            const next = nextDue(inside);
            const unfold = isUnfolded(g.id) && inside.length > 0;
            return (
              <div key={g.id} className={`dcv-group-block${unfold ? " is-open" : ""}`}>
                <button
                  type="button"
                  className={`dcv-item dcv-group${on ? " is-on" : ""}${open === g.id && openPlan ? " is-parent" : ""}`}
                  aria-pressed={on}
                  onClick={() => {
                    /* The group shown opens or closes; another one is shown, open. */
                    if (on) return setUnfolded((u) => ({ ...u, [g.id]: !isUnfolded(g.id) }));
                    onOpen(g.id);
                    setUnfolded((u) => ({ ...u, [g.id]: true }));
                  }}
                  onContextMenu={(e) => onMenu(e, g.id)}
                >
                  <span className="dcv-item-icon" aria-hidden>
                    <Folder />
                  </span>
                  <span className="dcv-item-main">
                    <b>{g.name}</b>
                    <small>
                      {inside.length ? w.plans(inside.length) : w.noPlanYet}
                      {f.invested > 0 ? ` · ${money(f.invested, unit(inside))}` : ""}
                      {next ? ` · ${w.next(when(next))}` : ""}
                    </small>
                  </span>
                  {f.pct !== undefined && <span className={`wlv-pill dcv-pill ${toneOf(f.pct)}`}>{pct(f.pct)}</span>}
                </button>
                {inside.length > 0 && (
                  <button type="button" className="dcv-toggle" onClick={() => setUnfolded((u) => ({ ...u, [g.id]: !unfold }))} aria-expanded={unfold} aria-label={unfold ? w.fold(g.name) : w.unfold(g.name)} title={unfold ? w.hidePlans : w.showPlans}>
                    <ChevronDown />
                  </button>
                )}
                {unfold && (
                  <ul className="dcv-subs" aria-label={w.plansOf(g.name)}>
                    {inside.map((p) => {
                      const pf = figures([p]);
                      const b = badgeOf(p, accounts);
                      const lit = openPlan === p.id;
                      return (
                        <li key={p.id}>
                          <button type="button" className={`dcv-sub${lit ? " is-on" : ""}${p.status !== "active" ? " is-idle" : ""}`} aria-current={lit || undefined} onClick={() => onPlan(p.id)} onContextMenu={(e) => onPlanMenu(e, p.id)}>
                            <span className="dcv-sub-main">
                              <span className="dcv-item-top">
                                <b>{planTitle(p)}</b>
                                <span className={badgeClass(b)}>{b}</span>
                              </span>
                              <small>{p.status === "active" ? w.next(when(p.nextDue)) : p.status === "paused" ? t.dca.status.paused : w.ended(frequencyPhrase(p.frequency))}</small>
                            </span>
                            {pf.pct !== undefined && <span className={`dcv-sub-pct ${toneOf(pf.pct)}`}>{pct(pf.pct)}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
      )}
    </section>
  );
}
