"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentConfig, Settings } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
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
import { openConversation, openSettings, setActiveConversation, useNavigation, type SettingsRequest } from "@/lib/state/navigation";
import { blankAgent } from "@/lib/storage/repositories";
import { addRule } from "@/lib/tools/permissions";
import {
  DEFAULT_PROFESSION,
  PROFESSIONS,
  isProfessionId,
  professionInfo,
} from "@/lib/professions/catalog";
import { acpAgentOf } from "@/lib/acp/agents";
import { COMMANDS, mergeCommands } from "@/lib/agent/commands";
import { useAgentCommands } from "@/lib/state/agent-commands";
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

/* The professions, as the picker shows them. */
const PROFESSION_OPTIONS = PROFESSIONS.map((p) => ({
  value: p.id,
  name: p.label,
  description: p.description,
}));

/* Our two modes, for an agent on OpenRouter: they are the permissions. */
const PERMISSION_MODES = [
  {
    value: "ask",
    name: "Ask before acting",
    description:
      "Every command and every file change waits for your permission.",
  },
  {
    value: "skip",
    name: "Direct execution",
    description: "Every tool runs without asking.",
  },
];

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** The panel's target from a request: the agent looked up by its id. */
const settingsTarget = (r: SettingsRequest, agents: AgentConfig[]): SettingsTarget => ({
  tab: r.tab,
  ...(r.agentId === "new" ? { agent: "new" as const } : r.agentId ? { agent: agents.find((a) => a.id === r.agentId) } : {}),
  ...(r.plugin ? { plugin: r.plugin } : {}),
});


/* ---------------------------------------------------------------------------
   The chat page: the column, the thread, the composer.

   The open agent lives in the settings (we find it again at the next
   launch); the open conversation lives here. A conversation only exists
   from the first message: before that, `active` is null and the thread
   greets. The model of a new conversation is the one last chosen for this
   agent, otherwise its provider's most recent one.
--------------------------------------------------------------------------- */
export function ChatShell({ settings }: Props) {
  const conversations = useConversations();
  const catalog = useCatalog();
  const acpAuth = useAcpAuth();
  const ui = useUiPrefs();
  /* The open conversation and the settings panel live in a shared store:
     a notification or a plugin's tab can bring the user here. */
  const nav = useNavigation();
  const active = nav.conversation;
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingEffort, setPendingEffort] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  /* The agent whose deletion is requested, for the duration of the
     confirmation. */
  const [deleting, setDeleting] = useState<AgentConfig | null>(null);

  const conversation = active
    ? (conversations.find((c) => c.id === active) ?? null)
    : null;
  /* ⚠️ AN OPEN CONVERSATION IS ANSWERED BY ITS OWN AGENT. Opening one
     makes its agent active (`openConversation`), but whatever path opened
     it, the thread never runs — nor labels its replies — with another
     agent's prompt, tools, workspace and permissions. */
  const agent =
    (conversation ? settings.agents.find((a) => a.id === conversation.agentId) : undefined) ??
    settings.agents.find((a) => a.id === settings.activeAgentId) ??
    settings.agents[0] ??
    null;

  const providerId = agent?.providerId ?? "";
  const fallback =
    agent?.defaultModelId && agent.defaultModelId.startsWith(`${providerId}/`)
      ? agent.defaultModelId
      : (latestModels(catalog.models, providerId, 1)[0]?.id ?? null);
  const modelId = conversation
    ? conversation.modelId
    : (pendingModel ?? fallback);

  /* The effort follows the model: the conversation's, otherwise the one
     kept for the agent — but only if the current model accepts it. */
  const currentModel = catalog.models.find((m) => m.id === modelId);
  const accepts = (e: string | null | undefined) =>
    e && currentModel && effortOptions(currentModel).includes(e) ? e : null;
  const effort = conversation
    ? accepts(conversation.effort)
    : accepts(pendingEffort ?? agent?.defaultEffort);

  const onConversationCreated = useCallback((id: string) => {
    setActiveConversation(id);
    setPendingModel(null);
    setPendingEffort(null);
    setPendingMode(null);
  }, []);

  /* "Always" memorises ONE rule for the agent that ran the turn — no
     more flipping to direct execution (see `lib/tools/permissions.ts`). */
  const onAllowRule = useCallback((id: string, rule: string) => {
    if (id)
      updateSettings((s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.id === id ? { ...a, allowRules: addRule(a.allowRules, rule) } : a,
        ),
      }));
  }, []);

  /* The mode: the ones the external agent publishes for a subscription,
     our two permission modes otherwise. The choice lives in the
     conversation (or pending before the first message) and becomes the
     agent's default. */
  const acp = acpAgentOf(agent?.providerId);
  const storageFull = useStorageFull();
  const agentAccounts = allowedAccounts(settings.keys.exchanges, agent?.exchangeAccountIds);
  const agentModes = acp ? (catalog.acpModes[acp.id] ?? null) : null;
  const modeOptions = acp ? (agentModes?.options ?? []) : PERMISSION_MODES;
  /* ⚠️ Only a mode the USER picked is sent to the server: it wins there
     (`turnMode`). With none, the server starts Codex in its asking mode
     (`askMode`) — so the picker shows that one, not whatever the agent's
     session happened to report. */
  const pickedMode = acp ? (conversation?.mode ?? pendingMode ?? agent?.defaultMode ?? null) : null;
  const askDefault = acp?.askMode && agentModes?.options.some((o) => o.value === acp.askMode) ? acp.askMode : null;
  const mode = acp ? (pickedMode ?? askDefault ?? agentModes?.current ?? null) : (agent?.permissionMode ?? "ask");
  /* The commands offered on `/`: ours, and a subscription agent's own —
     named after it, sent to it as typed. */
  const agentCommands = useAgentCommands(agent?.id, acp?.id);
  const commands = acp ? mergeCommands(agentCommands.map((c) => ({ ...c, source: acp.product }))) : COMMANDS;

  const { send, stop, retry, answer, streamingId, usage, rate, produced, compactError, dismissCompactError } =
    useChat({
      settings,
      agent: agent ?? blankAgent(),
      conversationId: active,
      modelId,
      effort,
      mode: pickedMode,
      window: currentModel?.contextLength ?? null,
      onConversationCreated,
      onAllowRule,
    });

  /* The meter is always shown: until an exact count has arrived, it shows
     an estimate of the thread, which grows live while the reply is being
     written. The last exact count is kept on the message, so it survives a
     reload. */
  const lastUsage = conversation
    ? [...conversation.messages].reverse().find((m) => m.usage)?.usage
    : undefined;
  const contextNow = contextEstimate(conversation?.messages ?? []) + produced;

  /* A conversation without a message yet: the greeting and the composer
     stand together in the middle of the page, as on Claude. When the first
     message leaves, the composer slides down to its place at the bottom —
     a FLIP: the layout jumps at once, then the composer is moved back to
     where it was and eased down. Only after a send of OURS (`sending`):
     opening an existing conversation from a new one must not play it.
     `follow` tells the thread a message left: it goes back to the bottom,
     even when the reader had scrolled up. */
  const fresh = !conversation || conversation.messages.length === 0;
  const composerBox = useRef<HTMLDivElement>(null);
  const composerTop = useRef<number | null>(null);
  const wasFresh = useRef(fresh);
  const sending = useRef(0);
  const [follow, setFollow] = useState(0);
  useLayoutEffect(() => {
    const el = composerBox.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const from = composerTop.current;
    const flipped = wasFresh.current && !fresh;
    composerTop.current = top;
    wasFresh.current = fresh;
    if (!flipped || from === null || Date.now() - sending.current > 3000) return;
    sending.current = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dy = from - top;
    if (Math.abs(dy) < 4) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 620, easing: "cubic-bezier(0.3, 0.68, 0.25, 1)" });
  });
  const submit: typeof send = (text, opts) => {
    sending.current = Date.now();
    setFollow((n) => n + 1);
    return send(text, opts);
  };

  /* Where attachments go: the open agent's workspace. */
  const cible = { agentId: agent?.id ?? "", workspace: agent?.workspace ?? "" };

  const togglePermission = () => {
    if (!agent) return;
    patchAgent(agent.id, (a) => ({
      ...a,
      permissionMode: a.permissionMode === "skip" ? "ask" : "skip",
    }));
  };
  /* One stream at a time: the composer shows it wherever we are, the
     thread only animates it if it is its own. */
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

  /* Changing profession changes the agent's prompt and skills — not the
     current conversation, which keeps its thread. */
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
    setActiveConversation(null);
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
    if (target.id === agent?.id) setActiveConversation(null);
  };

  const removeConv = (id: string) => {
    const owner = settings.agents.find((a) => a.id === conversations.find((c) => c.id === id)?.agentId);
    if (acpAgentOf(owner?.providerId)) void closeAcpConversation(id);
    removeConversation(id);
    if (id === active) setActiveConversation(null);
  };

  const saveAgent = (agent: AgentConfig, isNew: boolean) => {
    /* A new agent's id and date are stamped here, at creation. */
    const created: AgentConfig = { ...agent, id: newId(), createdAt: Date.now() };
    updateSettings((s) =>
      isNew
        ? { ...s, agents: [...s.agents, created], activeAgentId: created.id }
        : { ...s, agents: s.agents.map((a) => (a.id === agent.id ? agent : a)) },
    );
    if (isNew) {
      /* A created agent is a conversation that begins: the panel closes on
         this new agent's empty thread, not on the list. */
      setActiveConversation(null);
      setPendingModel(null);
      openSettings(null);
    }
  };

  /* THIS agent's access to the models: its key, or its connected
     subscription. */
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

  /* With no agent — all deleted — the creation sheet is forced. */
  const mustCreate = agent === null;
  const sheet: SettingsTarget | null = mustCreate ? { tab: "agents", agent: "new" } : nav.settings && settingsTarget(nav.settings, settings.agents);

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
        onNewAgent={() => openSettings({ tab: "agents", agentId: "new" })}
        onSelectAgent={(id) => {
          selectAgent(id);
          setMenu(false);
        }}
        onEditAgent={(a) => openSettings({ tab: "agents", agentId: a.id })}
        onRemoveAgent={(a) => setDeleting(a)}
        onNewConversation={() => {
          setActiveConversation(null);
          setMenu(false);
        }}
        onSelectConversation={(id) => {
          openConversation(id);
          setPendingModel(null);
          setPendingEffort(null);
          setPendingMode(null);
          setMenu(false);
        }}
        onRemoveConversation={removeConv}
        onRenameConversation={renameConversation}
        onSettings={() => openSettings({ tab: "general" })}
        onTheme={(theme) => updateSettings((s) => ({ ...s, theme }))}
        onCollapse={() => updateUiPrefs({ sidebarCollapsed: true })}
        onResize={(w) => updateUiPrefs({ sidebarWidth: clampWidth(w) })}
      />
      {menu && (
        <button
          type="button"
          className="chat-scrim"
          aria-label="Close the menu"
          onClick={() => setMenu(false)}
        />
      )}

      <main className={`chat-main${fresh ? " is-fresh" : ""}`}>
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
            title="Show the column"
          >
            <span />
            <span />
          </button>
          {/* Like the plugins' sheets: the conversation is the title, in
              BytNode's ink; who answers is the line under it. */}
          <div className="chat-head">
            <h1 className="chat-title">{conversation?.title ?? "New conversation"}</h1>
            {agent && (
              <p className="chat-sub">
                <span className="chat-agent">{agent.name}</span>
                <span className="chat-profession">
                  {professionInfo(agent.profession).label}
                </span>
              </p>
            )}
          </div>
          {/* Compaction is requested by typing /compact: no button here.
              The badge only flags the testnet — a live account is the
              normal case, not an alert to carry permanently in the header. */}
          {agent && agentAccounts.length > 0 && !anyLive(agentAccounts) && (
            <span className="xch-badge chat-xch" title={`Exchange accounts: ${describeAccounts(agentAccounts)}`}>
              TESTNET
            </span>
          )}
          {agent && !acp && (
            <button
              type="button"
              className={`chat-mode${agent.permissionMode === "skip" ? " is-skip" : ""}`}
              onClick={togglePermission}
              title={
                agent.permissionMode === "skip"
                  ? "Tools run without asking. Click to ask before acting."
                  : "The agent asks before running a command or changing a file. Click to run without asking."
              }
            >
              {agent.permissionMode === "skip"
                ? "Direct execution"
                : "Ask before acting"}
            </button>
          )}
        </header>

        {storageFull && (
          <div className="chat-notice">
            <div className="notice">
              <p>The browser storage is full: what is displayed will not survive a reload. Delete old conversations, or compact this one (/compact).</p>
            </div>
          </div>
        )}
        {compactError && compactError.conversationId === active && (
          <div className="chat-notice">
            <div className="notice" role="alert">
              <p>Compaction failed: {compactError.message}</p>
              <button type="button" className="btn btn-sm" onClick={() => void send("/compact")} disabled={busy}>
                Retry
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={dismissCompactError}>
                Close
              </button>
            </div>
          </div>
        )}
        {!hasKey && (
          <div className="chat-notice">
            <div className="notice">
              <p>
                {acp
                  ? `${acp.label} is not signed in: the agent cannot answer.`
                  : "No OpenRouter key: the agent cannot answer."}
              </p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => openSettings({ tab: acp ? "providers" : "auth" })}
              >
                Open the settings
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
            follow={follow}
          />
        )}

        <div className="chat-composer" ref={composerBox}>
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
            onSend={submit}
            onStop={stop}
            onAttachFiles={(files) => attachFiles(cible, files)}
            onScreenshot={() => attachScreenshot(cible)}
            focusKey={`${agent?.id ?? ""}:${active ?? "new"}`}
            docked={!fresh}
            commands={commands}
          />
          <p className="chat-foot">
            The agent can make mistakes. Check what matters.
          </p>
        </div>
        {/* Under the centred composer, the room that sets it a little
            above the middle. */}
        {fresh && <div className="chat-spacer" aria-hidden />}
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
          title={`Delete ${deleting.name}?`}
          body={(() => {
            const own = conversations.filter(
              (c) => c.agentId === deleting.id,
            ).length;
            return own === 0
              ? "The agent and its configuration will be deleted. This cannot be undone."
              : `The agent, its configuration and ${own === 1 ? "its conversation" : `its ${own} conversations`} will be deleted. This cannot be undone.`;
          })()}
          confirmLabel="Delete"
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
          onClose={mustCreate ? undefined : () => openSettings(null)}
        />
      )}
    </div>
  );
}
