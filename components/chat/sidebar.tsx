"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { ChevronDown, Dots, Pencil, Plus, Settings as SettingsIcon, Trash } from "@/components/ui/icons";
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
  /** Cliquer sur la marque replie la colonne. */
  onCollapse: () => void;
  /** La poignee du bord droit, en pixels. */
  onResize: (width: number) => void;
};

/* ---------------------------------------------------------------------------
   La colonne de gauche : les agents.

   Chaque agent est une ligne, repliee. Cliquer dessus le rend courant ET le
   deplie : ses conversations apparaissent dessous, « Nouvelle conversation »
   en tete ; un second clic le replie. Rien ne se deplie tout seul — pas meme
   l'agent courant au lancement — et plusieurs peuvent rester deplies. En haut,
   la marque et « Nouvel agent » ; en bas, vous et les reglages du compte.
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
  const who = settings.profile.firstName.trim() || "Vous";
  const aside = useRef<HTMLElement>(null);

  /* La poignee : on suit la souris jusqu'au relachement, et la largeur est
     la distance entre le bord gauche de la colonne et le curseur. */
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
  /* Les agents deplies : un etat de la colonne, distinct de l'agent
     courant. Plusieurs peuvent l'etre en meme temps — on compare deux
     agents sans refermer le premier. */
  const [expanded, setExpanded] = useState<string[]>([]);

  /* Replier l'agent courant ne change pas ce qu'on lit : la conversation
     ouverte reste ouverte. Seul un AUTRE agent devient courant. */
  const toggle = (id: string) => {
    if (id !== activeAgentId) onSelectAgent(id);
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <aside ref={aside} className={`sb${open ? " is-open" : ""}`} aria-label="Agents et conversations">
      <div className="sb-head">
        <button type="button" className="sb-brand" onClick={onCollapse} title="Replier la colonne">
          BytNode-AI
        </button>
        <ThemeToggle theme={settings.theme} onChange={onTheme} />
      </div>

      <button type="button" className="sb-new" onClick={onNewAgent}>
        <Plus />
        Nouvel agent
      </button>

      <nav className="sb-list">
        {settings.agents.length === 0 ? (
          <p className="sb-empty">Créez un premier agent pour commencer.</p>
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
                      <span className="sb-agent-name">{agent.name || "Sans nom"}</span>
                      <span className="sb-agent-meta">
                        {professionInfo(agent.profession).label} · {own.length === 0 ? "aucune conversation" : `${own.length} conversation${own.length > 1 ? "s" : ""}`}
                      </span>
                    </span>
                  </button>
                  <span className="sb-agent-actions">
                    <button type="button" className="sb-mini" onClick={() => onEditAgent(agent)} aria-label={`Modifier ${agent.name}`}>
                      <Pencil />
                    </button>
                    <button type="button" className="sb-mini" onClick={() => onRemoveAgent(agent)} aria-label={`Supprimer ${agent.name}`}>
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
                      Nouvelle conversation
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
        <button type="button" className="sb-settings" onClick={onSettings} aria-label="Réglages du compte" title="Réglages du compte">
          <SettingsIcon />
        </button>
      </div>

      <div className="sb-resize" onMouseDown={startResize} role="separator" aria-orientation="vertical" aria-label="Largeur de la colonne" />
    </aside>
  );
}

/* ---------------------------------------------------------------------------
   Une conversation dans la colonne : son titre, et trois points qui ouvrent
   un petit menu — renommer (le titre devient un champ, Entree valide,
   Echap annule), supprimer.
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

  /* Le menu se ferme au clic ailleurs et a Echap. */
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

  /* Tout selectionner a l'ouverture du champ seulement — pas a chaque
     frappe, sinon chaque lettre remplace la precedente. */
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
          aria-label="Nouveau titre"
        />
      ) : (
        <button type="button" className="sb-conv-btn" onClick={onSelect} title={conversation.title}>
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
          aria-label={`Options de « ${conversation.title} »`}
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
            Renommer
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
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
