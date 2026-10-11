"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { Agent as AgentIcon, ChevronDown, Clock, Dots, DotsVertical, Pencil, Plus, Settings as SettingsIcon, Trash } from "@/components/ui/icons";
import { reportLabel, taskFolders, type TaskFolder } from "@/lib/plugins/scheduler/conversation";
import { professionInfo } from "@/lib/professions/catalog";
import { useMessages } from "@/lib/i18n/react";

type Props = {
  settings: Settings;
  conversations: Conversation[];
  activeAgentId: string | null;
  activeConversationId: string | null;
  /** The agent whose page is open, if any. */
  agentPage: string | null;
  /** The Agents section folded (a habit, kept in `agentchat:ui`). */
  folded: boolean;
  onFold: (folded: boolean) => void;
  /** The Scheduled tasks section folded (kept in `agentchat:ui` too). */
  scheduledFolded: boolean;
  onFoldScheduled: (folded: boolean) => void;
  /** The « + » of the Scheduled tasks section: the scheduler's tab. */
  onOpenScheduler: () => void;
  open: boolean;
  onNewAgent: () => void;
  onOpenAgent: (id: string) => void;
  onEditAgent: (agent: AgentConfig) => void;
  onRemoveAgent: (agent: AgentConfig) => void;
  /** A new conversation with this agent. */
  onNewConversation: (agentId: string) => void;
  onSelectConversation: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onSettings: () => void;
  /** Clicking the brand collapses the column. */
  onCollapse: () => void;
};

/* How many conversations an agent shows in the column; « Show all » opens
   its page, which lists every one. */
const SHOWN = 5;

/** The newest first: the column follows what was last worked on. */
const newestFirst = (a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt;

/* ---------------------------------------------------------------------------
   The left column: the agents.

   At the top, the brand and « New agent ». Then the Agents section: its small title folds the whole list, its « + »
   creates an agent. Each agent is a row — its box icon, its name, three
   dots for its menu. Clicking the name opens the agent's PAGE (its
   conversations, instructions, context, scheduled tasks); the icon turns
   into a chevron under the hand and folds or unfolds its latest
   conversations, which hang under it on a thin line, « Show all » last.
   Under the agents and all they unfold, the Scheduled tasks section — the
   reports of the scheduled tasks, every agent's, one folder per task, kept
   apart from the conversations (user request, 2026-10-09: they mixed with
   the agents' own). At the bottom, you and the account settings.
--------------------------------------------------------------------------- */
export function Sidebar({
  settings,
  conversations,
  activeAgentId,
  activeConversationId,
  agentPage,
  folded,
  onFold,
  scheduledFolded,
  onFoldScheduled,
  onOpenScheduler,
  open,
  onNewAgent,
  onOpenAgent,
  onEditAgent,
  onRemoveAgent,
  onNewConversation,
  onSelectConversation,
  onRemoveConversation,
  onRenameConversation,
  onSettings,
  onCollapse,
}: Props) {
  const m = useMessages();
  const who = settings.profile.firstName.trim() || m.chat.sidebar.you;

  /* The unfolded agents: a state of the column, distinct from the current
     agent. The current one starts unfolded; opening an agent's page
     unfolds it; the icon's chevron folds it again. */
  const [expanded, setExpanded] = useState<string[]>(() => (activeAgentId ? [activeAgentId] : []));
  const toggle = (id: string) => setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const openAgent = (id: string) => {
    setExpanded((prev) => (prev.includes(id) ? prev : [...prev, id]));
    onOpenAgent(id);
  };

  return (
    <aside className={`sb${open ? " is-open" : ""}`} aria-label={m.chat.sidebar.label}>
      <div className="sb-head">
        <button type="button" className="sb-brand" onClick={onCollapse} title={m.chat.sidebar.collapse}>
          BytNode-AI
        </button>
      </div>

      <button type="button" className="sb-new" onClick={onNewAgent}>
        <Plus />
        {m.chat.sidebar.newAgent}
      </button>

      <div className="sb-section">
        <button type="button" className="sb-section-toggle" onClick={() => onFold(!folded)} aria-expanded={!folded} aria-controls="sb-agents">
          {m.chat.agents}
          <ChevronDown className={`sb-section-chevron${folded ? " is-folded" : ""}`} />
        </button>
        <button type="button" className="sb-section-add" onClick={onNewAgent} aria-label={m.chat.sidebar.newAgent} title={m.chat.sidebar.newAgent}>
          <Plus />
        </button>
      </div>

      {/* The agents and, under them and all they unfold, the scheduled
          tasks: one scroll for both. */}
      <div className="sb-scroll">
        <nav className="sb-list" id="sb-agents" hidden={folded}>
          {settings.agents.length === 0 ? (
            <p className="sb-empty">{m.chat.sidebar.empty}</p>
          ) : (
            settings.agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                conversations={conversations.filter((c) => c.agentId === agent.id && !c.scheduled).sort(newestFirst)}
                unfolded={expanded.includes(agent.id)}
                current={agent.id === activeAgentId}
                page={agent.id === agentPage}
                activeConversationId={activeConversationId}
                onToggle={() => toggle(agent.id)}
                onOpen={() => openAgent(agent.id)}
                onNewConversation={() => onNewConversation(agent.id)}
                onEdit={() => onEditAgent(agent)}
                onRemove={() => onRemoveAgent(agent)}
                onSelectConversation={onSelectConversation}
                onRemoveConversation={onRemoveConversation}
                onRenameConversation={onRenameConversation}
              />
            ))
          )}
        </nav>

        <ScheduledSection
          conversations={conversations}
          agents={settings.agents}
          folded={scheduledFolded}
          onFold={onFoldScheduled}
          onOpen={onOpenScheduler}
          activeConversationId={activeConversationId}
          onSelectConversation={onSelectConversation}
          onRemoveConversation={onRemoveConversation}
          onRenameConversation={onRenameConversation}
        />
      </div>

      <div className="sb-foot">
        <span className="sb-who">{who}</span>
        <button type="button" className="sb-settings" onClick={onSettings} aria-label={m.chat.sidebar.accountSettings} title={m.chat.sidebar.accountSettings}>
          <SettingsIcon />
        </button>
      </div>
    </aside>
  );
}

/** Closes a row's menu on a click elsewhere and on Escape. */
function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, root, close]);
}

/* ---------------------------------------------------------------------------
   The Scheduled tasks section: the reports of the scheduled tasks, every
   agent's, one FOLDER PER TASK (user request, 2026-10-09: « chaque tâche
   planifiée un dossier »), the folder of the latest report first. Its small
   title folds the whole section, like « Agents », and its « + » opens the
   scheduler's tab (user request); a folder's row — its
   chevron, the task's name, how many reports — folds its reports, newest
   first, each read as its date (`reportLabel`). The latest few, « Show
   all » unfolds the rest in place. A report stays an ordinary conversation
   (the user can reply); it only lives here instead of under its agent.
--------------------------------------------------------------------------- */
type ScheduledProps = {
  /** Every conversation: the reports are picked out and grouped here. */
  conversations: Conversation[];
  agents: AgentConfig[];
  folded: boolean;
  onFold: (folded: boolean) => void;
  /** Its « + »: the scheduler's tab, to add or change a task. */
  onOpen: () => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
};

function ScheduledSection({ conversations, agents, folded, onFold, onOpen, activeConversationId, onSelectConversation, onRemoveConversation, onRenameConversation }: ScheduledProps) {
  const m = useMessages();
  const folders = taskFolders(conversations);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || m.chat.unnamed;
  /* The unfolded folders; the one holding the open report starts unfolded. */
  const [open, setOpen] = useState<string[]>(() => folders.filter((f) => f.conversations.some((c) => c.id === activeConversationId)).map((f) => f.taskId));
  const toggle = (id: string) => setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="sb-scheduled">
      <div className="sb-section">
        <button type="button" className="sb-section-toggle" onClick={() => onFold(!folded)} aria-expanded={!folded} aria-controls="sb-scheduled">
          {m.chat.sidebar.scheduled}
          <ChevronDown className={`sb-section-chevron${folded ? " is-folded" : ""}`} />
        </button>
        <button type="button" className="sb-section-add" onClick={onOpen} aria-label={m.chat.sidebar.scheduled} title={m.chat.sidebar.scheduled}>
          <Plus />
        </button>
      </div>
      {!folded && (
        <div className="sb-tasks" id="sb-scheduled">
          {folders.length === 0 ? (
            <p className="sb-scheduled-empty">{m.chat.sidebar.scheduledEmpty}</p>
          ) : (
            folders.map((f) => (
              <TaskFolderRow
                key={f.taskId}
                folder={f}
                agentName={agentName(f.conversations[0].agentId)}
                unfolded={open.includes(f.taskId)}
                onToggle={() => toggle(f.taskId)}
                activeConversationId={activeConversationId}
                onSelectConversation={onSelectConversation}
                onRemoveConversation={onRemoveConversation}
                onRenameConversation={onRenameConversation}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

type TaskFolderProps = {
  folder: TaskFolder;
  agentName: string;
  unfolded: boolean;
  onToggle: () => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
};

function TaskFolderRow({ folder, agentName, unfolded, onToggle, activeConversationId, onSelectConversation, onRemoveConversation, onRenameConversation }: TaskFolderProps) {
  const m = useMessages();
  const [all, setAll] = useState(false);
  const list = folder.conversations;
  const shown = all ? list : list.slice(0, SHOWN);
  const holdsActive = list.some((c) => c.id === activeConversationId);

  return (
    <div className={`sb-task${unfolded ? " is-open" : ""}${holdsActive ? " is-current" : ""}`}>
      <button type="button" className="sb-task-row" onClick={onToggle} aria-expanded={unfolded} title={m.chat.sidebar.taskOf(folder.title, agentName)}>
        <ChevronDown className="sb-task-chevron" />
        <span className="sb-task-name">{folder.title}</span>
        <span className="sb-task-count">{list.length}</span>
      </button>
      {unfolded && (
        <div className="sb-convs sb-task-convs">
          {shown.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              label={reportLabel(c, folder)}
              agentName={agentName}
              active={c.id === activeConversationId}
              onSelect={() => onSelectConversation(c.id)}
              onRemove={() => onRemoveConversation(c.id)}
              onRename={(title) => onRenameConversation(c.id, title)}
            />
          ))}
          {list.length > SHOWN && (
            <button type="button" className="sb-conv-all" onClick={() => setAll(!all)}>
              {all ? m.chat.sidebar.showLess : m.chat.sidebar.showAllCount(list.length)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   An agent in the column, and the conversations it shows.
--------------------------------------------------------------------------- */
type AgentRowProps = {
  agent: AgentConfig;
  /** Its conversations, newest first. */
  conversations: Conversation[];
  unfolded: boolean;
  current: boolean;
  page: boolean;
  activeConversationId: string | null;
  onToggle: () => void;
  onOpen: () => void;
  onNewConversation: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onSelectConversation: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
};

function AgentRow({
  agent,
  conversations,
  unfolded,
  current,
  page,
  activeConversationId,
  onToggle,
  onOpen,
  onNewConversation,
  onEdit,
  onRemove,
  onSelectConversation,
  onRemoveConversation,
  onRenameConversation,
}: AgentRowProps) {
  const m = useMessages();
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [closeMenu] = useState(() => () => setMenu(false));
  useDismiss(menu, root, closeMenu);
  const name = agent.name || m.chat.unnamed;
  const shown = conversations.slice(0, SHOWN);

  return (
    <div className={`sb-agent${unfolded ? " is-open" : ""}${current ? " is-current" : ""}${page ? " is-page" : ""}`}>
      <div ref={root} className={`sb-agent-row${menu ? " is-menu" : ""}`}>
        <button
          type="button"
          className="sb-agent-fold"
          onClick={onToggle}
          aria-expanded={unfolded}
          aria-label={unfolded ? m.chat.sidebar.hideConversationsOf(name) : m.chat.sidebar.showConversationsOf(name)}
          title={unfolded ? m.chat.sidebar.hideConversations : m.chat.sidebar.showConversations}
        >
          <AgentIcon className="sb-agent-icon" />
          <ChevronDown className="sb-agent-chevron" />
        </button>
        <button type="button" className="sb-agent-btn" onClick={onOpen} title={`${name} — ${m.onboarding.professions[professionInfo(agent.profession).id].label}`}>
          {name}
        </button>
        <button
          type="button"
          className="sb-mini sb-agent-more"
          onClick={() => setMenu(!menu)}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={m.chat.sidebar.optionsFor(name)}
        >
          <DotsVertical />
        </button>
        {menu && (
          <div className="sb-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onNewConversation();
              }}
            >
              <Plus />
              {m.chat.newConversation}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onEdit();
              }}
            >
              <Pencil />
              {m.chat.sidebar.editAgent}
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
              {m.common.delete}
            </button>
          </div>
        )}
      </div>

      {unfolded && (
        <div className="sb-convs">
          {/* The first line under the agent: a new conversation with it —
              lit while that new, still empty conversation is the open one. */}
          <button type="button" className={`sb-conv-new${current && activeConversationId === null && !page ? " is-active" : ""}`} onClick={onNewConversation}>
            <Plus />
            {m.chat.newConversation}
          </button>
          {shown.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === activeConversationId}
                onSelect={() => onSelectConversation(c.id)}
                onRemove={() => onRemoveConversation(c.id)}
                onRename={(title) => onRenameConversation(c.id, title)}
              />
          ))}
          {conversations.length > 0 && (
            <button type="button" className="sb-conv-all" onClick={onOpen}>
              {conversations.length > SHOWN ? m.chat.sidebar.showAllCount(conversations.length) : m.chat.sidebar.showAll}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   A conversation in the column: its title, and three dots that open a small
   menu — rename (the title becomes a field, Enter confirms, Escape cancels),
   delete.
--------------------------------------------------------------------------- */
type RowProps = {
  conversation: Conversation;
  /** In a scheduled task's folder: whose report it is (in its tooltip),
      and the line shown instead of the title (its date). */
  agentName?: string;
  label?: string;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (title: string) => void;
};

function ConversationRow({ conversation, agentName, label, active, onSelect, onRemove, onRename }: RowProps) {
  const m = useMessages();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const [closeMenu] = useState(() => () => setMenu(false));
  useDismiss(menu, root, closeMenu);

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
    /* Not the Enter that confirms an IME composition (Chinese, Japanese…). */
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) commit();
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
          aria-label={m.chat.sidebar.newTitle}
        />
      ) : (
        <button type="button" className="sb-conv-btn" onClick={onSelect} title={conversation.scheduled ? m.chat.sidebar.report(conversation.title, agentName || null) : conversation.title}>
          {conversation.scheduled ? <Clock className="sb-conv-mark" /> : <span className="sb-conv-dot" aria-hidden />}
          {label ?? conversation.title}
        </button>
      )}
      {editing === null && (
        <button
          type="button"
          className="sb-mini sb-conv-more"
          onClick={() => setMenu(!menu)}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={m.chat.sidebar.optionsForConversation(conversation.title)}
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
            {m.common.rename}
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
            {m.common.delete}
          </button>
        </div>
      )}
    </div>
  );
}
