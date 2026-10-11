"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { AgentConfig, Conversation } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";
import { professionInfo } from "@/lib/professions/catalog";
import { relative } from "@/lib/plugins/scheduler/timeline";
import { useNow } from "@/lib/state/clock";
import { readContextFiles, fmtSize } from "@/components/onboarding/context-files";
import { Clock, Close, DotsVertical, File, Pencil, Plus, Trash } from "@/components/ui/icons";
import type { Messages } from "@/lib/i18n/messages/en";
import { useMessages } from "@/lib/i18n/react";
import "@/components/plugins/plugins.css";
import "@/components/plugins/watchlist/watchlist.css";
import "./agent-page.css";

type Props = {
  agent: AgentConfig;
  /** Its conversations, newest first. */
  conversations: Conversation[];
  /** The composer, built by the chat: writing here starts a conversation
      with this agent. */
  composer: ReactNode;
  /** The button that shows the column again when it is collapsed. */
  columnButton: ReactNode;
  onOpenConversation: (id: string) => void;
  onPatch: (patch: Partial<AgentConfig>) => void;
  onEdit: () => void;
  onRemove: () => void;
};

/* ---------------------------------------------------------------------------
   An agent's page, opened from its name in the column — in the bare views'
   language (plugins.css: the watchlist, the paper trading): no frame of its
   own, the app's beams behind.

   ONE sheet, round where it does not meet the tab bar, and in it one
   centred block of two columns on the same ground. On the left the
   agent's name in BytNode's ink and what it is, the composer —
   writing here starts a conversation with it —, its conversations,
   grouped by when they were last touched, each a row that lights up
   whole. On the right, its overview — the watchlist's fact tiles: how many
   conversations, when it last worked, its last two weeks of messages —
   then what shapes it: its instructions and its reference files.
--------------------------------------------------------------------------- */
export function AgentPage({ agent, conversations, composer, columnButton, onOpenConversation, onPatch, onEdit, onRemove }: Props) {
  const m = useMessages();
  const now = useNow();
  const acp = acpAgentOf(agent.providerId);
  const name = agent.name || m.chat.unnamed;
  const n = conversations.length;

  return (
    <div className="agv pv-bare">
      <main className="agv-sheet" aria-label={name}>
        <div className="agv-layout">
          <div className="agv-col">
            <header className="agv-head">
              {columnButton}
              <div className="wlv-title-block">
                <h1 className="wlv-sheet-title">
                  <span className="pv-ink">{name}</span>
                </h1>
                <p className="wlv-sheet-sub">
                  {m.onboarding.professions[professionInfo(agent.profession).id].label} · {acp ? m.chat.page.subscription(acp.label) : "OpenRouter"}
                </p>
              </div>
              <PageMenu onEdit={onEdit} onRemove={onRemove} />
            </header>

            <div className="agv-compose">{composer}</div>

            <section className="wlv-section agv-convs" aria-label={m.chat.conversations}>
              <h2 className="wlv-section-title">
                {m.chat.conversations} {n > 0 && <small>{n}</small>}
              </h2>
              {n === 0 ? (
                <p className="agv-quiet">{m.chat.page.empty(name)}</p>
              ) : (
                groups(conversations, now, m).map((g) => (
                  <div key={g.label} className="agv-group">
                    <p className="agv-group-label">{g.label}</p>
                    <ul className="agv-rows">
                      {g.items.map((c) => {
                        const line = excerpt(c);
                        return (
                          <li key={c.id}>
                            <button type="button" className="agv-row" onClick={() => onOpenConversation(c.id)}>
                              <span className="agv-row-text">
                                <b>
                                  {c.scheduled && <Clock className="agv-row-mark" />}
                                  {c.title}
                                </b>
                                {line && <small>{line}</small>}
                              </span>
                              <span className="agv-row-when">{now ? relative(c.updatedAt, now) : ""}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </section>
          </div>

          <aside className="agv-side" aria-label={m.chat.page.about}>
            <Overview conversations={conversations} now={now} />
            <Instructions value={agent.contextText} onSave={(contextText) => onPatch({ contextText })} />
            <ContextFiles agent={agent} onPatch={onPatch} />
          </aside>
        </div>
      </main>
    </div>
  );
}

/** The conversations by when they were last touched: today, this week,
    before. */
function groups(list: Conversation[], now: number, m: Messages): Array<{ label: string; items: Conversation[] }> {
  if (!now) return [{ label: m.chat.page.recent, items: list }];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const today = day.getTime();
  const week = today - 6 * 86_400_000;
  const out = [
    { label: m.common.today, items: list.filter((c) => c.updatedAt >= today) },
    { label: m.chat.page.thisWeek, items: list.filter((c) => c.updatedAt < today && c.updatedAt >= week) },
    { label: m.chat.page.earlier, items: list.filter((c) => c.updatedAt < week) },
  ];
  return out.filter((g) => g.items.length > 0);
}

/** The last thing said in a conversation, on one line. */
function excerpt(c: Conversation): string {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m.compacting) continue;
    const text = m.content
      .replace(/[`*_#>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  return "";
}

/* --- The overview: fact tiles of one block, like the watchlist's. ------- */

const DAYS = 14;
const DAY = 86_400_000;

/** Its messages over the last `DAYS` days, oldest first, today last. */
function activity(conversations: Conversation[], now: number): number[] {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const first = day.getTime() - (DAYS - 1) * DAY;
  const out = new Array<number>(DAYS).fill(0);
  for (const c of conversations)
    for (const m of c.messages) {
      if (m.compacting || m.createdAt < first) continue;
      const i = Math.floor((m.createdAt - first) / DAY);
      if (i >= 0 && i < DAYS) out[i] += 1;
    }
  return out;
}

function Overview({ conversations, now }: { conversations: Conversation[]; now: number }) {
  const m = useMessages();
  const n = conversations.length;
  const latest = conversations[0];
  const weekAgo = now - 7 * DAY;
  const thisWeek = now ? conversations.filter((c) => c.updatedAt >= weekAgo).length : 0;
  const days = now ? activity(conversations, now) : new Array<number>(DAYS).fill(0);
  const total = days.reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...days);

  return (
    <Part title={m.chat.page.overview}>
      <div className="wlv-insights agv-overview" style={{ "--cols": 2 } as React.CSSProperties}>
        <div className="wlv-insight">
          <span className="wlv-insight-label">{m.chat.conversations}</span>
          <span className="wlv-insight-value">{n}</span>
          <span className="wlv-insight-sub">{thisWeek > 0 ? m.chat.page.thisWeekCount(thisWeek) : m.chat.page.noneThisWeek}</span>
        </div>
        <div className="wlv-insight">
          <span className="wlv-insight-label">{m.chat.page.lastActive}</span>
          <span className="wlv-insight-value">{latest && now ? relative(latest.updatedAt, now) : "—"}</span>
          <span className="wlv-insight-sub">{latest ? latest.title : m.chat.page.neverYet}</span>
        </div>
        <div className="wlv-insight agv-activity">
          <span className="wlv-insight-label">{m.chat.page.messages}</span>
          <span className="wlv-insight-value">
            {total}
            <small>{m.chat.page.inDays(DAYS)}</small>
          </span>
          <span className="agv-bars" aria-hidden>
            {days.map((v, i) => (
              <i key={i} className={i === DAYS - 1 ? "is-today" : v === 0 ? "is-empty" : undefined} style={{ "--h": `${v === 0 ? 0 : Math.max(10, (v / peak) * 100)}%` } as React.CSSProperties} />
            ))}
          </span>
        </div>
      </div>
    </Part>
  );
}

/* --- A part of the side column: a title, its « + », its block. ---------- */
function Part({ title, action, children, ...drop }: { title: string; action?: ReactNode; children: ReactNode } & Partial<Record<"onDragOver" | "onDragLeave" | "onDrop", (e: DragEvent) => void>>) {
  return (
    <section className="agv-part" {...drop}>
      <div className="agv-part-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* The page's three dots: edit the agent, delete it. */
function PageMenu({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="agv-menu" ref={root}>
      <button type="button" className="wlv-icon" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={m.chat.page.options}>
        <DotsVertical />
      </button>
      {open && (
        <div className="wlv-menu agv-menu-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            className="wlv-menu-item"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Pencil />
            {m.chat.sidebar.editAgent}
          </button>
          <button
            type="button"
            role="menuitem"
            className="wlv-menu-item is-danger"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <Trash />
            {m.chat.page.deleteAgent}
          </button>
        </div>
      )}
    </div>
  );
}

/* --- Instructions: the agent's context text, edited in place. ------------ */
function Instructions({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const m = useMessages();
  const [draft, setDraft] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  const text = value.trim();

  return (
    <Part
      title={m.chat.page.instructions}
      action={
        !editing && (
          <button type="button" className="wlv-icon" onClick={() => setDraft(value)} aria-label={text ? m.chat.page.editInstructions : m.chat.page.addInstructions} title={text ? m.common.edit : m.common.add}>
            {text ? <Pencil /> : <Plus />}
          </button>
        )
      }
    >
      {editing ? (
        <div className="agv-edit">
          <textarea
            ref={area}
            className="wlv-input agv-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={m.chat.page.instructionsPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
            }}
          />
          <div className="agv-edit-bar">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
              {m.common.cancel}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                onSave(draft);
                setDraft(null);
              }}
            >
              {m.common.save}
            </button>
          </div>
        </div>
      ) : text ? (
        <button type="button" className="agv-block agv-instructions" onClick={() => setDraft(value)} title={m.chat.page.editInstructions}>
          {text}
        </button>
      ) : (
        <p className="wlv-insight-message">{m.chat.page.instructionsEmpty}</p>
      )}
    </Part>
  );
}

/* --- Context: the reference files, read once and kept as text. ---------- */
function ContextFiles({ agent, onPatch }: { agent: AgentConfig; onPatch: (patch: Partial<AgentConfig>) => void }) {
  const m = useMessages();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const files = agent.contextFiles;

  const add = async (list: FileList | File[]) => {
    const { accepted, refused: why } = await readContextFiles(list, files.length);
    if (accepted.length) onPatch({ contextFiles: [...files, ...accepted] });
    setRefused(why);
  };
  const browse = () => input.current?.click();

  return (
    <Part
      title={m.chat.page.context}
      action={
        <button type="button" className="wlv-icon" onClick={browse} aria-label={m.chat.page.addReferenceFiles} title={m.chat.page.addFiles}>
          <Plus />
        </button>
      }
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void add(e.target.files);
          e.target.value = "";
        }}
      />
      {files.length === 0 ? (
        <button type="button" className={`agv-block agv-drop${over ? " is-over" : ""}`} onClick={browse}>
          <span className="agv-drop-art" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span>{m.chat.page.dropHint}</span>
        </button>
      ) : (
        <ul className={`agv-tiles${over ? " is-over" : ""}`}>
          {files.map((f) => (
            <li key={f.id} className="agv-file">
              <File />
              <span className="agv-file-name">{f.name}</span>
              <span className="agv-file-size">{fmtSize(f.size)}</span>
              <button type="button" className="agv-file-remove" onClick={() => onPatch({ contextFiles: files.filter((x) => x.id !== f.id) })} aria-label={m.chat.composer.remove(f.name)}>
                <Close />
              </button>
            </li>
          ))}
        </ul>
      )}
      {refused && (
        <p className="agv-refused" role="alert">
          {refused}
        </p>
      )}
    </Part>
  );
}
