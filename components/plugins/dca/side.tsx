"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import { frequencyWords, nextDue, type Figures, type PlanRow } from "@/lib/plugins/dca/view-model";
import { Folder, Plus } from "@/components/ui/icons";
import { badgeClass, badgeOf, money, pct, toneOf, when } from "./format";
import type { Scope } from "./view";

/* ---------------------------------------------------------------------------
   The left column: one block of tiles, as the portfolio's — "All plans"
   first, then each group (a project: its plans are listed when it is
   opened, not here), then the plans that belong to none. The one open is
   lit. A right click opens the item's menu (rename or delete a group; move,
   pause or delete a plan). Under the block, "New DCA" and "New group" —
   the group's name typed in place.
--------------------------------------------------------------------------- */

type Props = {
  plans: PlanRow[] | null;
  groups: DcaGroup[];
  accounts: ExchangeAccount[];
  figures: (plans: PlanRow[]) => Figures;
  unit: (plans: PlanRow[]) => string;
  scope: Scope;
  onScope: (s: Scope) => void;
  onMenu: (e: ReactMouseEvent<HTMLElement>, target: { kind: "group" | "plan"; id: string }) => void;
  /** Makes a group; answers why not, or null. */
  onCreateGroup: (name: string) => Promise<string | null>;
};

export function Side({ plans, groups, accounts, figures, unit, scope, onScope, onMenu, onCreateGroup }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = plans ?? [];
  const loose = all.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId));
  const whole = figures(all);
  const u = unit(all);

  const create = async () => {
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
    <section className="wlv-pane wlv-side dcv-side" aria-label="Recurring purchases">
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">DCA</span>
        </h2>
        {all.length > 0 && <span className="wlv-count">{all.length}</span>}
      </header>

      {plans === null ? (
        <p className="dcv-side-note">Reading your plans…</p>
      ) : (
        <nav className="dcv-nav" aria-label="Plans and groups">
          <button type="button" className={`dcv-whole${scope.kind === "all" ? " is-on" : ""}`} aria-pressed={scope.kind === "all"} onClick={() => onScope({ kind: "all" })}>
            <span className="dcv-whole-label">All plans</span>
            <span className="dcv-whole-value">{whole.value !== undefined ? money(whole.value, u) : money(whole.invested, u)}</span>
            <span className="dcv-whole-sub">
              {all.length ? `${all.length} plan${all.length === 1 ? "" : "s"} · ${money(whole.invested, u)} invested` : "No plan yet"}
              {whole.pct !== undefined && <b className={toneOf(whole.pct)}>{pct(whole.pct)}</b>}
            </span>
          </button>

          {groups.map((g) => {
            const inside = all.filter((p) => p.groupId === g.id);
            const f = figures(inside);
            const on = scope.kind === "group" && scope.id === g.id;
            const next = nextDue(inside);
            return (
              <button key={g.id} type="button" className={`dcv-item dcv-group${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onScope({ kind: "group", id: g.id })} onContextMenu={(e) => onMenu(e, { kind: "group", id: g.id })}>
                <span className="dcv-item-icon" aria-hidden>
                  <Folder />
                </span>
                <span className="dcv-item-main">
                  <b>{g.name}</b>
                  <small>
                    {inside.length} plan{inside.length === 1 ? "" : "s"}
                    {f.invested > 0 ? ` · ${money(f.invested, unit(inside))}` : ""}
                    {next ? ` · next ${when(next)}` : ""}
                  </small>
                </span>
                {f.pct !== undefined && <span className={`wlv-pill dcv-pill ${toneOf(f.pct)}`}>{pct(f.pct)}</span>}
              </button>
            );
          })}

          {loose.map((p) => {
            const f = figures([p]);
            const on = scope.kind === "plan" && scope.id === p.id;
            const badge = badgeOf(p, accounts);
            return (
              <button key={p.id} type="button" className={`dcv-item${on ? " is-on" : ""}${p.status !== "active" ? " is-idle" : ""}`} aria-pressed={on} onClick={() => onScope({ kind: "plan", id: p.id })} onContextMenu={(e) => onMenu(e, { kind: "plan", id: p.id })}>
                <span className="dcv-item-main">
                  <span className="dcv-item-top">
                    <b>{p.symbol.split("/")[0]}</b>
                    <span className={badgeClass(badge)}>{badge}</span>
                    {p.status === "paused" && <span className="dcv-state">paused</span>}
                    {p.status === "ended" && <span className="dcv-state">ended</span>}
                  </span>
                  <small>
                    {p.quoteAmount} {p.symbol.split("/")[1]} · {frequencyWords(p.frequency)}
                  </small>
                </span>
                {f.pct !== undefined && <span className={`wlv-pill dcv-pill ${toneOf(f.pct)}`}>{pct(f.pct)}</span>}
              </button>
            );
          })}
        </nav>
      )}

      <div className="dcv-new">
        <button type="button" className={`dcv-new-open${scope.kind === "new" ? " is-on" : ""}`} onClick={() => onScope({ kind: "new" })}>
          <Plus />
          New DCA
        </button>
        {naming ? (
          <form
            className="dcv-new-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void create();
            }}
          >
            <input className="wlv-input" aria-label="Name of the new group" placeholder="Group name — “Long term”" value={name} autoFocus maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(false)} />
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
                Cancel
              </button>
              <button type="submit" className="dcv-button is-primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create group"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="dcv-new-open" onClick={() => setNaming(true)}>
            <Folder />
            New group
          </button>
        )}
      </div>
    </section>
  );
}
