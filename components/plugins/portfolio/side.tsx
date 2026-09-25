"use client";

import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { Summary } from "@/lib/plugins/portfolio/aggregate";
import type { AccountGroup } from "@/lib/plugins/portfolio/groups";
import { ChevronDown, Folder, FolderOpen, Plus } from "@/components/ui/icons";
import { CurrencyMenu } from "./currency-menu";

/* The left column, a navigator: the tab's name with the currency beside
   it, then one block of tiles (the report's language): "All portfolios" — the whole, its total and its move over the
   period — then each account, to see it on its own: its LIVE / TESTNET
   badge (never dropped: which money is real is a guarantee of the app),
   its exchange, its value and its share of the whole as a thin bar, or
   why it could not be read.

   Between the whole and the accounts, the user's groups of accounts
   ("Long term" = Binance + Kraken) as folders, each with its own report.
   A folder is closed by default: its accounts are listed only inside it,
   shown when it is opened (its chevron, or one of its accounts shown). A
   click on a folder shows its report, open; a click on the folder shown
   opens or closes it, like the chevron. The accounts in no folder follow. A right click edits
   or deletes a folder. Under the block, "New group" opens a small form in
   place — a name, the accounts ticked — which also edits one. */

export const ALL = "all";
export const accountKey = (a: { exchange: string; label: string }) => `${a.exchange}:${a.label}`;
export const groupKey = (id: string) => `group:${id}`;

/** The group form open: a new group, or the one being edited. */
export type Editing = { kind: "new" } | { kind: "edit"; id: string };

/** An account as the settings know it: listed at once, before its
    balances are read. */
export type Known = { id: string; label: string; exchange: string; testnet: boolean };

type Props = {
  summary: Summary | null;
  known: Known[];
  /** Why the balances could not be read, if they could not. */
  problem: string | null;
  scope: string;
  onScope: (key: string) => void;
  currency: string;
  onCurrency: (c: string) => void;
  value: (usd: number) => string;
  /** The whole's move over the period, already written ("+4.2 %"). */
  move: { text: string; tone: string } | null;
  groups: AccountGroup[];
  /** Each group's live total, in USD (read with the summary). */
  groupTotal: (g: AccountGroup) => number | null;
  onGroupMenu: (e: ReactMouseEvent<HTMLElement>, id: string) => void;
  editing: Editing | null;
  onEditing: (e: Editing | null) => void;
  /** Saves the form; answers why not, or null. */
  onSaveGroup: (draft: { id?: string; name: string; accountIds: string[] }) => Promise<string | null>;
};

export function Side({ summary, known, problem, scope, onScope, currency, onCurrency, value, move, groups, groupTotal, onGroupMenu, editing, onEditing, onSaveGroup }: Props) {
  const accounts = summary?.accounts ?? [];
  const total = summary?.totalUsd ?? 0;
  const edited = editing?.kind === "edit" ? groups.find((g) => g.id === editing.id) : undefined;
  /* Folded by default: a folder opens by hand, or when it is clicked, or
     when one of its accounts is the one shown. */
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});

  /* Every account by its settings id: read (with its figures), else still
     being read. An account without an id (never in a group) by its key. */
  const ids = summary ? accounts.map((a) => a.id ?? accountKey(a)) : known.map((a) => a.id);
  const keyOf = (id: string) => {
    const a = accounts.find((x) => (x.id ?? accountKey(x)) === id);
    return a ? accountKey(a) : id;
  };
  /* The accounts in a folder are listed only in it. */
  const grouped = new Set(groups.flatMap((g) => g.accountIds));
  const loose = ids.filter((id) => !grouped.has(id));

  const tile = (id: string) => {
    const a = accounts.find((x) => (x.id ?? accountKey(x)) === id);
    if (!a) {
      const k = known.find((x) => x.id === id);
      if (!k) return null;
      return (
        <div className="pfv-account is-pending">
          <span className="pfv-account-top">
            <span className={`xch-badge${k.testnet ? "" : " is-live"}`}>{k.testnet ? "TESTNET" : "LIVE"}</span>
            <b>{k.label}</b>
          </span>
          <span className="pfv-account-sub">{problem ? `Not read: ${problem}` : `${k.exchange} · reading the balances…`}</span>
        </div>
      );
    }
    const key = accountKey(a);
    const share = !a.testnet && total > 0 ? a.usd / total : 0;
    return (
      <button type="button" className={`pfv-account${scope === key ? " is-on" : ""}${a.error ? " is-error" : ""}`} aria-pressed={scope === key} onClick={() => onScope(key)}>
        <span className="pfv-account-top">
          <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
          <b>{a.label}</b>
          <span className="pfv-account-value">{value(a.usd)}</span>
        </span>
        <span className="pfv-account-sub">
          {a.error ? `Could not be read: ${a.error}` : `${a.exchange}${a.testnet ? " · not counted" : ` · ${(share * 100).toFixed(1)} %`}${a.unpriced ? ` · ${a.unpriced} unpriced` : ""}`}
        </span>
        {!a.testnet && !a.error && (
          <span className="pfv-account-bar" aria-hidden>
            <i style={{ "--w": `${share * 100}%` } as CSSProperties} />
          </span>
        )}
      </button>
    );
  };

  return (
    <section className="wlv-pane wlv-side pfv-side" aria-label="Portfolios">
      <header className="pfv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">Portfolio</span>
        </h2>
        <CurrencyMenu value={currency} onChange={onCurrency} />
      </header>

      {(summary || known.length > 0) && (
        <nav className="pfv-nav" aria-label="Portfolios">
          {summary && (
            <button type="button" className={`pfv-whole${scope === ALL ? " is-on" : ""}`} aria-pressed={scope === ALL} onClick={() => onScope(ALL)}>
              <span className="pfv-whole-label">All portfolios</span>
              <span className="pfv-whole-value">{value(total)}</span>
              <span className="pfv-whole-sub">
                {accounts.filter((a) => !a.testnet).length} live account{accounts.filter((a) => !a.testnet).length === 1 ? "" : "s"}
                {move && <b className={move.tone}>{move.text}</b>}
              </span>
            </button>
          )}

          {groups.map((g) => {
            const key = groupKey(g.id);
            const usd = groupTotal(g);
            const inside = g.accountIds.filter((id) => known.some((a) => a.id === id) || accounts.some((a) => a.id === id));
            const holdsScope = inside.some((id) => scope === keyOf(id));
            const open = inside.length > 0 && (unfolded[g.id] ?? holdsScope);
            return (
              <div key={g.id} className={`pfv-group-block${open ? " is-open" : ""}`}>
                <button
                  type="button"
                  className={`pfv-account pfv-group${scope === key ? " is-on" : ""}${holdsScope ? " is-parent" : ""}`}
                  aria-pressed={scope === key}
                  onClick={() => {
                    /* The folder shown opens or closes; another one is shown, open. */
                    if (scope === key) return setUnfolded((u) => ({ ...u, [g.id]: !open }));
                    onScope(key);
                    setUnfolded((u) => ({ ...u, [g.id]: true }));
                  }}
                  onContextMenu={(e) => onGroupMenu(e, g.id)}
                >
                  <span className="pfv-account-top">
                    <span className="pfv-group-icon" aria-hidden>
                      {open ? <FolderOpen /> : <Folder />}
                    </span>
                    <b>{g.name}</b>
                    <span className="pfv-account-value">{usd === null ? "—" : value(usd)}</span>
                  </span>
                  <span className="pfv-account-sub">
                    {inside.length} account{inside.length === 1 ? "" : "s"}
                    {usd !== null && total > 0 ? ` · ${((usd / total) * 100).toFixed(1)} %` : ""}
                  </span>
                </button>
                {inside.length > 0 && (
                  <button type="button" className="pfv-fold" onClick={() => setUnfolded((u) => ({ ...u, [g.id]: !open }))} aria-expanded={open} aria-label={`${open ? "Close" : "Open"} ${g.name}`} title={open ? "Hide its accounts" : "Show its accounts"}>
                    <ChevronDown />
                  </button>
                )}
                {open && (
                  <ul className="pfv-accounts pfv-subs" aria-label={`The accounts of ${g.name}`}>
                    {inside.map((id) => (
                      <li key={id}>{tile(id)}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {loose.length > 0 && (
            <ul className="pfv-accounts">
              {loose.map((id) => (
                <li key={id}>{tile(id)}</li>
              ))}
            </ul>
          )}
        </nav>
      )}

      {known.length > 0 &&
        (editing && (editing.kind === "new" || edited) ? (
          <GroupForm key={editing.kind === "new" ? "new" : editing.id} group={edited} known={known} onCancel={() => onEditing(null)} onSave={onSaveGroup} />
        ) : (
          <button type="button" className="pfv-new-group" onClick={() => onEditing({ kind: "new" })}>
            <Plus />
            New group
          </button>
        ))}
    </section>
  );
}

/** A group's name and its accounts, ticked. */
function GroupForm({ group, known, onCancel, onSave }: { group?: AccountGroup; known: Known[]; onCancel: () => void; onSave: Props["onSaveGroup"] }) {
  const [name, setName] = useState(group?.name ?? "");
  const [ids, setIds] = useState<string[]>(group ? group.accountIds.filter((id) => known.some((a) => a.id === id)) : []);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <form
      className="pfv-group-form"
      aria-label={group ? `Edit ${group.name}` : "New group of accounts"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const p = await onSave({ ...(group ? { id: group.id } : {}), name, accountIds: ids });
        setBusy(false);
        setProblem(p);
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <input className="wlv-input" aria-label="Name of the group" placeholder="Group name — “Long term”" value={name} autoFocus maxLength={40} onChange={(e) => setName(e.target.value)} />
      <fieldset className="pfv-group-pick">
        <legend>Accounts in the group</legend>
        {known.map((a) => (
          <label key={a.id} className="pfv-group-option">
            <input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
            <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
            <b>{a.label}</b>
            <small>{a.exchange}</small>
          </label>
        ))}
      </fieldset>
      {problem && <p className="pfv-group-problem">{problem}</p>}
      <div className="pfv-group-actions">
        <button type="button" className="pfv-group-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="pfv-group-button is-primary" disabled={busy || !name.trim() || ids.length === 0}>
          {busy ? "Saving…" : group ? "Save" : "Create group"}
        </button>
      </div>
    </form>
  );
}
