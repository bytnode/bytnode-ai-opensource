"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import { nextDue, type Figures, type PlanRow } from "@/lib/plugins/dca/view-model";
import { Folder, Plus } from "@/components/ui/icons";
import { money, pct, toneOf, when } from "./format";

/* ---------------------------------------------------------------------------
   The left column: the groups, and nothing else — one block of tiles, as
   the portfolio's. A group says how many DCAs it holds, what went in, when
   the next purchase is and its result; the one open is lit. A right click
   renames or deletes it. Under the block, "New group" — its name typed in
   place. The DCAs themselves open in the sheet, inside their group.
--------------------------------------------------------------------------- */

type Props = {
  groups: DcaGroup[] | null;
  plans: PlanRow[];
  figures: (plans: PlanRow[]) => Figures;
  unit: (plans: PlanRow[]) => string;
  /** The group open. */
  open: string | null;
  onOpen: (id: string) => void;
  onMenu: (e: ReactMouseEvent<HTMLElement>, id: string) => void;
  /** Makes a group; answers why not, or null. */
  onCreateGroup: (name: string) => Promise<string | null>;
};

export function Side({ groups, plans, figures, unit, open, onOpen, onMenu, onCreateGroup }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <section className="wlv-pane wlv-side dcv-side" aria-label="DCA groups">
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">DCA</span>
        </h2>
        {groups && groups.length > 0 && <span className="wlv-count">{groups.length}</span>}
      </header>

      {groups === null ? (
        <p className="dcv-side-note">Reading your groups…</p>
      ) : groups.length === 0 ? (
        <p className="dcv-side-note">No group yet: make one to hold your DCAs.</p>
      ) : (
        <nav className="dcv-nav" aria-label="Groups">
          {groups.map((g) => {
            const inside = plans.filter((p) => p.groupId === g.id);
            const f = figures(inside);
            const on = open === g.id;
            const next = nextDue(inside);
            return (
              <button key={g.id} type="button" className={`dcv-item dcv-group${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onOpen(g.id)} onContextMenu={(e) => onMenu(e, g.id)}>
                <span className="dcv-item-icon" aria-hidden>
                  <Folder />
                </span>
                <span className="dcv-item-main">
                  <b>{g.name}</b>
                  <small>
                    {inside.length ? `${inside.length} DCA${inside.length === 1 ? "" : "s"}` : "No DCA yet"}
                    {f.invested > 0 ? ` · ${money(f.invested, unit(inside))}` : ""}
                    {next ? ` · next ${when(next)}` : ""}
                  </small>
                </span>
                {f.pct !== undefined && <span className={`wlv-pill dcv-pill ${toneOf(f.pct)}`}>{pct(f.pct)}</span>}
              </button>
            );
          })}
        </nav>
      )}

      <div className="dcv-new">
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
            <Plus />
            New group
          </button>
        )}
      </div>
    </section>
  );
}
