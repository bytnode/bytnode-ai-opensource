"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { ChevronDown, Clock, Dots, Pencil, Plus, Settings as SettingsIcon, Trash } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { professionInfo } from "@/lib/professions/catalog";

type Props = {
  settings: Settings;
  conversations: Conversation[];
  activeAgentId: string | null;
  activeConversationId: string | null;
  open: boolean;
  onNewAgent: () => void;
  onSelectAgent: (id: string) => void;
  onEditAgent: (agent: AgentConfig) => void;
  onRemoveAgent: (agent: AgentConfig) => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onSettings: () => void;
  onTheme: (theme: Settings["theme"]) => void;
  /** Clicking the brand collapses the column. */
  onCollapse: () => void;
  /** The right-edge handle, in pixels. */
  onResize: (width: number) => void;
};

/* ---------------------------------------------------------------------------
   The left column: the agents.

   Each agent is a row, folded. Clicking it makes it current AND unfolds it:
   its conversations appear underneath, "New conversation" on top; a second
   click folds it. Nothing unfolds on its own — not even the current agent at
   launch — and several can stay unfolded. At the top, the brand and "New
   agent"; at the bottom, you and the account settings.
--------------------------------------------------------------------------- */
export function Sidebar({
  settings,
  conversations,
  activeAgentId,
  activeConversationId,
  open,
  onNewAgent,
  onSelectAgent,
  onEditAgent,
  onRemoveAgent,
  onNewConversation,
  onSelectConversation,
  onRemoveConversation,
  onRenameConversation,
  onSettings,
  onTheme,
  onCollapse,
  onResize,
}: Props) {
  const who = settings.profile.firstName.trim() || "You";
  const aside = useRef<HTMLElement>(null);

  /* The handle: we follow the mouse until release, and the width is the
     distance between the column's left edge and the cursor. */
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const left = aside.current?.getBoundingClientRect().left ?? 0;
    const move = (ev: MouseEvent) => onResize(ev.clientX - left);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  /* The unfolded agents: a state of the column, distinct from the current
     agent. Several can be unfolded at once — we compare two agents without
     closing the first. */
  const [expanded, setExpanded] = useState<string[]>([]);

  /* Folding the current agent does not change what we are reading: the
     open conversation stays open. Only ANOTHER agent becomes current. */
  const toggle = (id: string) => {
    if (id !== activeAgentId) onSelectAgent(id);
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <aside ref={aside} className={`sb${open ? " is-open" : ""}`} aria-label="Agents and conversations">
      <div className="sb-head">
        <button type="button" className="sb-brand" onClick={onCollapse} title="Collapse the column">
          BytNode-AI
        </button>
        <ThemeToggle theme={settings.theme} onChange={onTheme} />
      </div>

      <button type="button" className="sb-new" onClick={onNewAgent}>
        <Plus />
        New agent
      </button>

      {settings.agents.length > 0 && <p className="sb-title">Agents</p>}
      <nav className="sb-list">
        {settings.agents.length === 0 ? (
          <p className="sb-empty">Create a first agent to get started.</p>
        ) : (
          settings.agents.map((agent) => {
            const openHere = expanded.includes(agent.id);
            const current = agent.id === activeAgentId;
            const own = conversations.filter((c) => c.agentId === agent.id);
            return (
              <div key={agent.id} className={`sb-agent${openHere ? " is-open" : ""}${current ? " is-current" : ""}`}>
                <div className="sb-agent-row">
                  <button
                    type="button"
                    className="sb-agent-btn"
                    onClick={() => toggle(agent.id)}
                    aria-expanded={openHere}
                    title={agent.name}
                  >
                    <ChevronDown className="sb-agent-chevron" />
                    <span className="sb-agent-text">
                      <span className="sb-agent-name">{agent.name || "Unnamed"}</span>
                      <span className="sb-agent-meta">
                        {professionInfo(agent.profession).label} · {own.length === 0 ? "no conversation" : `${own.length} conversation${own.length > 1 ? "s" : ""}`}
                      </span>
                    </span>
                  </button>
                  <span className="sb-agent-actions">
                    <button type="button" className="sb-mini" onClick={() => onEditAgent(agent)} aria-label={`Edit ${agent.name}`}>
                      <Pencil />
                    </button>
                    <button type="button" className="sb-mini" onClick={() => onRemoveAgent(agent)} aria-label={`Delete ${agent.name}`}>
                      <Trash />
                    </button>
                  </span>
                </div>

                {openHere && (
                  <div className="sb-convs">
                    <button
                      type="button"
                      className={`sb-conv sb-conv-new${activeConversationId === null ? " is-active" : ""}`}
                      onClick={onNewConversation}
                    >
                      <Plus />
                      New conversation
                    </button>
                    {own.map((c) => (
                      <ConversationRow
                        key={c.id}
                        conversation={c}
                        active={c.id === activeConversationId}
                        onSelect={() => onSelectConversation(c.id)}
                        onRemove={() => onRemoveConversation(c.id)}
                        onRename={(title) => onRenameConversation(c.id, title)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>

      <div className="sb-foot">
        <span className="sb-who">{who}</span>
        <button type="button" className="sb-settings" onClick={onSettings} aria-label="Account settings" title="Account settings">
          <SettingsIcon />
        </button>
      </div>

      <div className="sb-resize" onMouseDown={startResize} role="separator" aria-orientation="vertical" aria-label="Column width" />
    </aside>
  );
}

/* ---------------------------------------------------------------------------
   A conversation in the column: its title, and three dots that open a small
   menu — rename (the title becomes a field, Enter confirms, Escape cancels),
   delete.
--------------------------------------------------------------------------- */
type RowProps = {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (title: string) => void;
};

function ConversationRow({ conversation, active, onSelect, onRemove, onRename }: RowProps) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  /* The menu closes on a click elsewhere and on Escape. */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /* Select all only when the field opens — not on every keystroke,
     otherwise each letter replaces the previous one. */
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing) input.current?.select();
  }, [isEditing]);

  const commit = () => {
    if (editing !== null) onRename(editing);
    setEditing(null);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(null);
  };

  return (
    <div ref={root} className={`sb-conv${active ? " is-active" : ""}${menu ? " is-menu" : ""}`}>
      {editing !== null ? (
        <input
          ref={input}
          className="sb-conv-input"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          aria-label="New title"
        />
      ) : (
        <button type="button" className="sb-conv-btn" onClick={onSelect} title={conversation.scheduled ? `${conversation.title} — report of a scheduled task` : conversation.title}>
          {conversation.scheduled && <Clock className="sb-conv-mark" />}
          {conversation.title}
        </button>
      )}
      {editing === null && (
        <button
          type="button"
          className="sb-mini sb-conv-more"
          onClick={() => setMenu(!menu)}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`Options for "${conversation.title}"`}
        >
          <Dots />
        </button>
      )}
      {menu && (
        <div className="sb-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setEditing(conversation.title);
            }}
          >
            <Pencil />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setMenu(false);
              onRemove();
            }}
          >
            <Trash />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
