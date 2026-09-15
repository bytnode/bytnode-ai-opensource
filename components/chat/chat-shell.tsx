"use client";

import { useCallback, useState } from "react";
import type { AgentConfig, Settings } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
import { worthCompacting } from "@/lib/agent/compact";
import { contextEstimate } from "@/lib/agent/usage";
import { attachFiles, attachScreenshot } from "@/lib/agent/attach-client";
import { effortOptions, latestModels } from "@/lib/catalog/catalog";
import { useCatalog } from "@/lib/catalog/use-catalog";
import {
  removeConversation,
  removeConversationsOfAgent,
  renameConversation,
  saveConversation,
  useConversations,
  useStorageFull,
} from "@/lib/state/conversations";
import { updateSettings } from "@/lib/state/settings";
import { clampWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { blankAgent } from "@/lib/storage/repositories";
import { addRule } from "@/lib/tools/permissions";
import {
  DEFAULT_PROFESSION,
  PROFESSIONS,
  isProfessionId,
  professionInfo,
} from "@/lib/professions/catalog";
import { acpAgentOf } from "@/lib/acp/agents";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { closeAcpConversation } from "@/lib/acp/client";
import { SettingsPanel, type SettingsTarget } from "@/components/settings/settings-panel";
import { allowedAccounts, anyLive, describeAccounts } from "@/lib/tools/exchange/accounts";
import { Composer } from "./composer";
import { Sidebar } from "./sidebar";
import { Thread } from "./thread";
import { UsageMeter } from "./usage-meter";
import { useChat } from "./use-chat";
import "./chat.css";

type Props = { settings: Settings };

/* Les metiers, tels que le selecteur les montre. */
const PROFESSION_OPTIONS = PROFESSIONS.map((p) => ({
  value: p.id,
  name: p.label,
  description: p.description,
}));

/* Nos deux modes, pour un agent sur OpenRouter : ce sont les permissions. */
const PERMISSION_MODES = [
  {
    value: "ask",
    name: "Demande avant d'agir",
    description:
      "Chaque commande et chaque modification de fichier attend votre accord.",
  },
  {
    value: "skip",
    name: "Exécution directe",
    description: "Tous les outils s'exécutent sans demander.",
  },
];

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/* Le panneau de reglages, s'il est ouvert : l'onglet, et l'agent a editer. */
type Editing = SettingsTarget | null;

/* ---------------------------------------------------------------------------
   La page de dialogue : la colonne, le fil, le bloc de saisie.

   L'agent ouvert vit dans les reglages (on le retrouve au prochain
   lancement) ; la conversation ouverte vit ici. Une conversation n'existe
   qu'a partir du premier message : avant, `active` est nul et le fil salue.
   Le modele d'une conversation nouvelle est celui choisi la derniere fois
   pour cet agent, sinon le plus recent de son fournisseur.
--------------------------------------------------------------------------- */
export function ChatShell({ settings }: Props) {
  const conversations = useConversations();
  const catalog = useCatalog();
  const acpAuth = useAcpAuth();
  const ui = useUiPrefs();
  const [active, setActive] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingEffort, setPendingEffort] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  /* L'agent dont on demande la suppression, le temps de la confirmation. */
  const [deleting, setDeleting] = useState<AgentConfig | null>(null);

  const agent =
    settings.agents.find((a) => a.id === settings.activeAgentId) ??
    settings.agents[0] ??
    null;
  const conversation = active
    ? (conversations.find((c) => c.id === active) ?? null)
    : null;

  const providerId = agent?.providerId ?? "";
  const fallback =
    agent?.defaultModelId && agent.defaultModelId.startsWith(`${providerId}/`)
      ? agent.defaultModelId
      : (latestModels(catalog.models, providerId, 1)[0]?.id ?? null);
  const modelId = conversation
    ? conversation.modelId
    : (pendingModel ?? fallback);

  /* L'effort suit le modele : celui de la conversation, sinon celui retenu
     pour l'agent — mais seulement si le modele du moment l'accepte. */
  const currentModel = catalog.models.find((m) => m.id === modelId);
  const accepts = (e: string | null | undefined) =>
    e && currentModel && effortOptions(currentModel).includes(e) ? e : null;
  const effort = conversation
    ? accepts(conversation.effort)
    : accepts(pendingEffort ?? agent?.defaultEffort);

  const onConversationCreated = useCallback((id: string) => {
    setActive(id);
    setPendingModel(null);
    setPendingEffort(null);
    setPendingMode(null);
  }, []);

  /* « Toujours » memorise UNE regle pour cet agent — plus de bascule en
     execution directe (voir `lib/tools/permissions.ts`). */
  const onAllowRule = useCallback(
    (rule: string) => {
      const id = settings.activeAgentId;
      if (id)
        updateSettings((s) => ({
          ...s,
          agents: s.agents.map((a) =>
            a.id === id ? { ...a, allowRules: addRule(a.allowRules, rule) } : a,
          ),
        }));
    },
    [settings.activeAgentId],
  );

  /* Le mode : ceux que l'agent externe publie pour un abonnement, nos deux
     modes de permission sinon. Le choix vit dans la conversation (ou en
     attente avant le premier message) et devient le defaut de l'agent. */
  const acp = acpAgentOf(agent?.providerId);
  const storageFull = useStorageFull();
  const agentAccounts = allowedAccounts(settings.keys.exchanges, agent?.exchangeAccountIds);
  const agentModes = acp ? (catalog.acpModes[acp.id] ?? null) : null;
  const modeOptions = acp ? (agentModes?.options ?? []) : PERMISSION_MODES;
  const mode = acp
    ? (conversation?.mode ??
      pendingMode ??
      agent?.defaultMode ??
      agentModes?.current ??
      null)
    : (agent?.permissionMode ?? "ask");

  const { send, stop, retry, answer, streamingId, usage, rate, produced } =
    useChat({
      settings,
      agent: agent ?? blankAgent(),
      conversationId: active,
      modelId,
      effort,
      mode: acp ? mode : null,
      window: currentModel?.contextLength ?? null,
      onConversationCreated,
      onAllowRule,
    });

  /* La jauge est toujours affichee : tant qu'aucun decompte exact n'est
     arrive, elle montre une estimation du fil, qui grandit en direct
     pendant que la reponse s'ecrit. Le dernier decompte exact est garde sur
     le message, donc il survit au rechargement. */
  const lastUsage = conversation
    ? [...conversation.messages].reverse().find((m) => m.usage)?.usage
    : undefined;
  const contextNow = contextEstimate(conversation?.messages ?? []) + produced;

  /* Ou vont les pieces jointes : le dossier de travail de l'agent ouvert. */
  const cible = { agentId: agent?.id ?? "", workspace: agent?.workspace ?? "" };

  const togglePermission = () => {
    if (!agent) return;
    patchAgent(agent.id, (a) => ({
      ...a,
      permissionMode: a.permissionMode === "skip" ? "ask" : "skip",
    }));
  };
  /* Un seul flux a la fois : le bloc de saisie le montre ou qu'on soit, le
     fil ne l'anime que s'il est le sien. */
  const busy = streamingId !== null;
  const streaming = busy && streamingId === active;

  const patchAgent = (id: string, patch: (a: AgentConfig) => AgentConfig) =>
    updateSettings((s) => ({
      ...s,
      agents: s.agents.map((a) => (a.id === id ? patch(a) : a)),
    }));

  const chooseModel = (id: string) => {
    if (conversation) saveConversation({ ...conversation, modelId: id });
    else setPendingModel(id);
    if (agent) patchAgent(agent.id, (a) => ({ ...a, defaultModelId: id }));
  };

  /* Changer de profession change le prompt et les competences de l'agent —
     pas la conversation en cours, qui garde son fil. */
  const chooseProfession = (next: string) => {
    if (!agent || !isProfessionId(next) || next === agent.profession) return;
    patchAgent(agent.id, (a) => ({ ...a, profession: next }));
  };

  const chooseMode = (next: string) => {
    if (!agent) return;
    if (!acp) {
      patchAgent(agent.id, (a) => ({
        ...a,
        permissionMode: next === "skip" ? "skip" : "ask",
      }));
      return;
    }
    if (conversation) saveConversation({ ...conversation, mode: next });
    else setPendingMode(next);
    patchAgent(agent.id, (a) => ({ ...a, defaultMode: next }));
  };

  const chooseEffort = (e: string | null) => {
    if (conversation) saveConversation({ ...conversation, effort: e });
    else setPendingEffort(e);
    if (agent) patchAgent(agent.id, (a) => ({ ...a, defaultEffort: e }));
  };

  const selectAgent = (id: string) => {
    updateSettings((s) => ({ ...s, activeAgentId: id }));
    setActive(null);
    setPendingModel(null);
    setPendingEffort(null);
    setPendingMode(null);
  };

  const removeAgent = (target: AgentConfig) => {
    if (acpAgentOf(target.providerId))
      for (const c of conversations)
        if (c.agentId === target.id) void closeAcpConversation(c.id);
    removeConversationsOfAgent(target.id);
    updateSettings((s) => {
      const agents = s.agents.filter((a) => a.id !== target.id);
      const activeAgentId =
        s.activeAgentId === target.id
          ? (agents[0]?.id ?? null)
          : s.activeAgentId;
      return { ...s, agents, activeAgentId };
    });
    if (target.id === agent?.id) setActive(null);
  };

  const removeConv = (id: string) => {
    if (acpAgentOf(agent?.providerId)) void closeAcpConversation(id);
    removeConversation(id);
    if (id === active) setActive(null);
  };

  const saveAgent = (agent: AgentConfig, isNew: boolean) => {
    /* L'id et la date d'un agent nouveau sont poses ici, a la creation. */
    const created: AgentConfig = { ...agent, id: newId(), createdAt: Date.now() };
    updateSettings((s) =>
      isNew
        ? { ...s, agents: [...s.agents, created], activeAgentId: created.id }
        : { ...s, agents: s.agents.map((a) => (a.id === agent.id ? agent : a)) },
    );
    if (isNew) {
      /* Un agent cree, c'est une conversation qui commence : le panneau se
         ferme sur le fil vide de ce nouvel agent, pas sur la liste. */
      setActive(null);
      setPendingModel(null);
      setEditing(null);
    }
  };

  /* L'acces aux modeles de CET agent : sa cle, ou son abonnement connecte. */
  const hasKey = acp
    ? (() => {
        const st = acpAuth.agents.find((a) => a.agent === acp.id);
        return (
          st?.loggedIn === true ||
          st?.checking === true ||
          acpAuth.status !== "ready"
        );
      })()
    : settings.keys.openrouter.trim().length > 0;

  /* Sans agent — tous supprimes — la feuille de creation s'impose. */
  const mustCreate = agent === null;
  const sheet: Editing = mustCreate ? { tab: "agents", agent: "new" } : editing;

  return (
    <div
      className={`chat${menu ? " menu-open" : ""}${ui.sidebarCollapsed ? " is-collapsed" : ""}`}
      style={{ "--sidebar": `${ui.sidebarWidth}px` } as React.CSSProperties}
    >
      <Sidebar
        settings={settings}
        conversations={conversations}
        activeAgentId={agent?.id ?? null}
        activeConversationId={active}
        open={menu}
        onNewAgent={() => setEditing({ tab: "agents", agent: "new" })}
        onSelectAgent={(id) => {
          selectAgent(id);
          setMenu(false);
        }}
        onEditAgent={(a) => setEditing({ tab: "agents", agent: a })}
        onRemoveAgent={(a) => setDeleting(a)}
        onNewConversation={() => {
          setActive(null);
          setMenu(false);
        }}
        onSelectConversation={(id) => {
          setActive(id);
          setMenu(false);
        }}
        onRemoveConversation={removeConv}
        onRenameConversation={renameConversation}
        onSettings={() => setEditing({ tab: "general" })}
        onTheme={(theme) => updateSettings((s) => ({ ...s, theme }))}
        onCollapse={() => updateUiPrefs({ sidebarCollapsed: true })}
        onResize={(w) => updateUiPrefs({ sidebarWidth: clampWidth(w) })}
      />
      {menu && (
        <button
          type="button"
          className="chat-scrim"
          aria-label="Fermer le menu"
          onClick={() => setMenu(false)}
        />
      )}

      <main className="chat-main">
        <header className="chat-top">
          <button
            type="button"
            className="chat-menu"
            onClick={() =>
              ui.sidebarCollapsed
                ? updateUiPrefs({ sidebarCollapsed: false })
                : setMenu(!menu)
            }
            aria-label="Agents"
            title="Afficher la colonne"
          >
            <span />
            <span />
          </button>
          {agent && (
            <span className="chat-agent">
              {agent.name}
              <span className="chat-profession">
                {professionInfo(agent.profession).label}
              </span>
            </span>
          )}
          {conversation && (
            <span className="chat-title">{conversation.title}</span>
          )}
          {conversation && worthCompacting(conversation.messages) && (
            <button
              type="button"
              className="chat-compact"
              onClick={() => send("/compact")}
              disabled={busy}
              title="Remplacer le fil par un résumé : l'agent garde ce qui compte, la conversation s'allège. Vous pouvez aussi taper /compact."
            >
              Compacter
            </button>
          )}
          {agent && agentAccounts.length > 0 && (
            <span className={`xch-badge chat-xch${anyLive(agentAccounts) ? " is-live" : ""}`} title={`Comptes exchange : ${describeAccounts(agentAccounts)}`}>
              {anyLive(agentAccounts) ? "RÉEL" : "TESTNET"}
            </span>
          )}
          {agent && !acp && (
            <button
              type="button"
              className={`chat-mode${agent.permissionMode === "skip" ? " is-skip" : ""}`}
              onClick={togglePermission}
              title={
                agent.permissionMode === "skip"
                  ? "Les outils s'exécutent sans demander. Cliquer pour demander avant d'agir."
                  : "L'agent demande avant d'exécuter une commande ou de modifier un fichier. Cliquer pour exécuter sans demander."
              }
            >
              {agent.permissionMode === "skip"
                ? "Exécution directe"
                : "Demande avant d'agir"}
            </button>
          )}
        </header>

        {storageFull && (
          <div className="chat-notice">
            <div className="notice">
              <p>Le stockage du navigateur est plein : ce qui s&apos;affiche ne survivra pas à un rechargement. Supprimez d&apos;anciennes conversations, ou compactez celle-ci.</p>
            </div>
          </div>
        )}
        {!hasKey && (
          <div className="chat-notice">
            <div className="notice">
              <p>
                {acp
                  ? `${acp.label} n'est pas connecté : l'agent ne peut pas répondre.`
                  : "Aucune clé OpenRouter : l'agent ne peut pas répondre."}
              </p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditing({ tab: acp ? "providers" : "auth" })}
              >
                Ouvrir les réglages
              </button>
            </div>
          </div>
        )}

        {agent && (
          <Thread
            key={conversation?.id ?? "new"}
            settings={settings}
            agent={agent}
            conversation={conversation}
            streaming={streaming}
            onRetry={retry}
            onAnswer={answer}
          />
        )}

        <div className="chat-composer">
          <Composer
            key={`${agent?.id ?? ""}:${active ?? "new"}`}
            providerId={providerId}
            modelId={modelId}
            effort={effort}
            onModel={chooseModel}
            onEffort={chooseEffort}
            mode={mode}
            modeOptions={modeOptions}
            onMode={chooseMode}
            profession={agent?.profession ?? DEFAULT_PROFESSION}
            professionOptions={PROFESSION_OPTIONS}
            onProfession={chooseProfession}
            streaming={busy}
            disabled={!hasKey || !agent}
            onSend={send}
            onStop={stop}
            onAttachFiles={(files) => attachFiles(cible, files)}
            onScreenshot={() => attachScreenshot(cible)}
            focusKey={`${agent?.id ?? ""}:${active ?? "new"}`}
          />
          <p className="chat-foot">
            L&apos;agent peut se tromper. Vérifiez ce qui compte.
          </p>
        </div>
      </main>

      <UsageMeter
        usage={usage ?? lastUsage}
        rate={rate}
        estimate={contextNow}
        window={currentModel?.contextLength ?? null}
        streaming={busy}
      />

      {deleting && (
        <ConfirmDialog
          title={`Supprimer ${deleting.name} ?`}
          body={(() => {
            const own = conversations.filter(
              (c) => c.agentId === deleting.id,
            ).length;
            return own === 0
              ? "L'agent et sa configuration seront supprimés. Cette action est définitive."
              : `L'agent, sa configuration et ${own === 1 ? "sa conversation" : `ses ${own} conversations`} seront supprimés. Cette action est définitive.`;
          })()}
          confirmLabel="Supprimer"
          onConfirm={() => {
            removeAgent(deleting);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {sheet && (
        <SettingsPanel
          key={`${sheet.tab}:${sheet.agent === "new" ? "new" : (sheet.agent?.id ?? "")}`}
          settings={settings}
          target={sheet}
          onUpdate={(patch) => updateSettings((s) => ({ ...s, ...patch }))}
          onSaveAgent={saveAgent}
          onRemoveAgent={(a) => setDeleting(a)}
          onClose={mustCreate ? undefined : () => setEditing(null)}
        />
      )}
    </div>
  );
}
