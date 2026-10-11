"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentConfig, Settings } from "@/lib/domain/types";
import type { Messages } from "@/lib/i18n/messages/en";
import { PanelLeft } from "@/components/ui/icons";
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
import { SIDEBAR_WIDTH, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { openAgentPage, openConversation, openSettings, setActiveConversation, useNavigation, type SettingsRequest } from "@/lib/state/navigation";
import { HOME, activateTab, openView } from "@/lib/state/tabs";
import { blankAgent } from "@/lib/storage/repositories";
import { addRule } from "@/lib/tools/permissions";
import {
  DEFAULT_PROFESSION,
  PROFESSIONS,
  isProfessionId,
  professionInfo,
} from "@/lib/professions/catalog";
import { acpAgentOf, isRetiredAcpModel } from "@/lib/acp/agents";
import { useMessages } from "@/lib/i18n/react";
import { COMMANDS, mergeCommands } from "@/lib/agent/commands";
import { useAgentCommands } from "@/lib/state/agent-commands";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { closeAcpConversation } from "@/lib/acp/client";
import { SettingsPanel, type SettingsTarget } from "@/components/settings/settings-panel";
import { allowedAccounts, anyLive, describeAccounts } from "@/lib/tools/exchange/accounts";
import { AgentPage } from "./agent-page";
import { Composer } from "./composer";
import { FloatingChat } from "./floating-chat";
import { WidgetsGallery, WidgetsLayer, WidgetsMenu } from "./widgets/widgets-layer";
import { useWidgets } from "@/lib/state/widgets";
import { Sidebar } from "./sidebar";
import { Thread } from "./thread";
import { UsageMeter } from "./usage-meter";
import { useChat } from "./use-chat";
import "./chat.css";

/** `front`: the conversations' tab is the one shown. Behind a plugin's
    tab, the page stays mounted (its reply keeps streaming) and the
    floating agent carries the conversation over the plugin. */
type Props = { settings: Settings; front: boolean };

/* The professions, as the picker shows them — in the interface's
   language (`onboarding.professions`). */
const professionOptions = (m: Messages) =>
  PROFESSIONS.map((p) => ({
    value: p.id,
    name: m.onboarding.professions[p.id].label,
    description: m.onboarding.professions[p.id].description,
  }));

/* Our two modes, for an agent on OpenRouter: they are the permissions. */
const permissionModes = (m: Messages) => [
  {
    value: "ask",
    name: m.chat.modes.ask.name,
    description: m.chat.modes.ask.description,
  },
  {
    value: "skip",
    name: m.chat.modes.skip.name,
    description: m.chat.modes.skip.description,
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
export function ChatShell({ settings, front }: Props) {
  const m = useMessages();
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
  /* The first launch's welcome, while it writes itself (`thread.tsx`): the
     page alone, without its column, which comes back when it is written
     (2026-10-09). */
  const intro = !!conversation && conversation.messages.length === 1 && !!conversation.messages[0].intro;
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
  /* An old conversation of a removed subscription (Gemini CLI) takes the
     agent's current model — and so does the first-launch welcome, made
     before any model was chosen (`modelId` empty, `lib/onboarding/
     first-run.ts`). */
  const modelId = conversation
    ? (!conversation.modelId || isRetiredAcpModel(conversation.modelId) ? fallback : conversation.modelId)
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
  const modeOptions = acp ? (agentModes?.options ?? []) : permissionModes(m);
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
  /* The agent's page stands where a new conversation would: no thread is
     open, and the page is the current agent's. */
  const onPage = !conversation && agent !== null && nav.agentPage === agent.id;
  const composerBox = useRef<HTMLDivElement>(null);
  /* The command list opens INSIDE the composer, which grows upward. In a
     new conversation the room around the centred pair is shared between
     the greeting and the spacer under the composer: the spacer is held at
     its height while the list is open, so the greeting moves up and the
     field stays where the user is typing. */
  const spacer = useRef<HTMLDivElement>(null);
  /* Measured while the list is closed: once it is open, the layout has
     already moved. */
  const spacerRest = useRef(0);
  const paletteOpen = useRef(false);
  useLayoutEffect(() => {
    const el = spacer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!paletteOpen.current) spacerRest.current = el.getBoundingClientRect().height;
    });
    ro.observe(el);
    return () => ro.disconnect();
    /* `onPage`: leaving an agent's page mounts a new spacer. */
  }, [fresh, onPage]);
  /* Shrinkable: the greeting gives its room first (down to its own
     height), and the field moves down only if the list still needs more. */
  const onPalette = useCallback((open: boolean) => {
    paletteOpen.current = open;
    const el = spacer.current;
    if (!el) return;
    el.style.flex = open && spacerRest.current > 0 ? `0 1 ${spacerRest.current}px` : "";
  }, []);
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

  /* The widgets (user request, 2026-10-06): they float on the page; the
     header's button, where « Ask before acting » was (the permission mode
     stays in the composer's settings, Mode), opens their menu. */
  const widgets = useWidgets();
  const [widgetsEditing, setWidgetsEditing] = useState(false);
  const [widgetsGallery, setWidgetsGallery] = useState(false);
  const closeWidgetsGallery = useCallback(() => setWidgetsGallery(false), []);
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

  /* An agent's name in the column opens its page; the page's composer
     starts a conversation with it. */
  const openAgent = (id: string) => {
    openAgentPage(id);
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
  /* Not launchable (never installed, or an install left incomplete): the
     way out is « Install », not a sign-in. */
  const acpMissing = !!acp && acpAuth.agents.find((a) => a.agent === acp.id)?.available === false;

  /* With no agent — all deleted — the creation sheet is forced. */
  const mustCreate = agent === null;
  const sheet: SettingsTarget | null = mustCreate ? { tab: "agents", agent: "new" } : nav.settings && settingsTarget(nav.settings, settings.agents);

  /* Shows the column again (collapsed, or a drawer when narrow). */
  const columnButton = (
    <button
      type="button"
      className="chat-menu"
      onClick={() =>
        ui.sidebarCollapsed
          ? updateUiPrefs({ sidebarCollapsed: false })
          : setMenu(!menu)
      }
      aria-label={m.chat.agents}
      title={m.chat.showColumn}
    >
      <PanelLeft />
    </button>
  );

  /* The composer: the page's, and the floating conversation's (`mini`) —
     the same engine, one line always, no glow, no foot. */
  const composerFor = (mini: boolean) => (
    <div className="chat-composer" ref={mini ? undefined : composerBox}>
      <Composer
        key={`${mini ? "mini:" : ""}${agent?.id ?? ""}:${active ?? "new"}`}
        providerId={providerId}
        modelId={modelId}
        effort={effort}
        onModel={chooseModel}
        onEffort={chooseEffort}
        mode={mode}
        modeOptions={modeOptions}
        onMode={chooseMode}
        profession={agent?.profession ?? DEFAULT_PROFESSION}
        professionOptions={professionOptions(m)}
        onProfession={chooseProfession}
        streaming={busy}
        disabled={!hasKey || !agent}
        locked={
          hasKey
            ? null
            : {
                message: !acp ? m.chat.locked.noKey : acpMissing ? m.chat.locked.needsInstall(acp.label) : m.chat.locked.notSignedIn(acp.label),
                action: !acp ? m.chat.locked.addKey : acpMissing ? m.chat.locked.install(acp.label) : m.chat.locked.signIn(acp.label),
                onAction: () => openSettings({ tab: acp ? "providers" : "auth" }),
              }
        }
        onSend={submit}
        onStop={stop}
        onAttachFiles={(files) => attachFiles(cible, files)}
        onScreenshot={() => attachScreenshot(cible)}
        focusKey={`${mini ? "mini:" : ""}${agent?.id ?? ""}:${active ?? "new"}${onPage && !mini ? ":page" : ""}`}
        docked={mini || !fresh}
        commands={commands}
        onPalette={onPage || mini ? undefined : onPalette}
        placeholder={mini ? (conversation ? m.chat.composer.reply : m.chat.composer.howCanIHelp) : onPage ? m.chat.composer.howCanIHelpToday : undefined}
      />
      {!onPage && !mini && <p className="chat-foot">{m.chat.foot}</p>}
    </div>
  );
  const composer = composerFor(false);

  /* --- The floating agent, over the plugins' tabs ------------------------ */

  /* A permission waits in the running reply. */
  const running = streamingId ? conversations.find((c) => c.id === streamingId) : undefined;
  const waiting = running?.messages.at(-1)?.steps?.some((s) => s.type === "tool" && s.status === "pending") ?? false;
  const byRecent = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const resetPending = () => {
    setPendingModel(null);
    setPendingEffort(null);
    setPendingMode(null);
  };
  const floating = (
    <FloatingChat
      shown={!front && ui.floatingAgent && !mustCreate}
      title={conversation?.title ?? m.chat.newConversation}
      agentName={agent?.name.trim() || m.chat.yourAgent}
      activeId={active}
      agents={settings.agents.map((a) => ({ id: a.id, name: a.name.trim() || m.chat.unnamed, profession: m.onboarding.professions[professionInfo(a.profession).id].label }))}
      agentId={agent?.id ?? null}
      conversations={byRecent.filter((c) => !c.scheduled).map((c) => ({
        id: c.id,
        agentId: c.agentId,
        title: c.title,
        updatedAt: c.updatedAt,
      }))}
      busy={busy}
      waiting={waiting}
      thread={
        agent && (
          <Thread
            key={`mini:${conversation?.id ?? "new"}`}
            settings={settings}
            agent={agent}
            conversation={conversation}
            streaming={streaming}
            onRetry={retry}
            onAnswer={answer}
            follow={follow}
          />
        )
      }
      composer={composerFor(true)}
      onOpen={() => {
        /* The running conversation first (a permission may wait there),
           otherwise the open one, otherwise the last used. */
        const target = streamingId ?? active ?? byRecent[0]?.id ?? null;
        if (target && target !== active) {
          openConversation(target);
          resetPending();
        }
      }}
      onPick={(id) => {
        openConversation(id);
        resetPending();
      }}
      onNewWith={(id) => {
        if (id !== agent?.id) updateSettings((s) => ({ ...s, activeAgentId: id }));
        setActiveConversation(null);
        resetPending();
      }}
      onExpand={() => activateTab(HOME)}
    />
  );

  return (
    <div
      className={`chat${menu ? " menu-open" : ""}${ui.sidebarCollapsed ? " is-collapsed" : ""}${intro ? " is-intro" : ""}`}
      style={{ "--sidebar": `${SIDEBAR_WIDTH}px` } as React.CSSProperties}
    >
      <Sidebar
        settings={settings}
        conversations={conversations}
        activeAgentId={agent?.id ?? null}
        activeConversationId={active}
        agentPage={onPage ? agent.id : null}
        folded={ui.agentsFolded}
        onFold={(agentsFolded) => updateUiPrefs({ agentsFolded })}
        scheduledFolded={ui.scheduledFolded}
        onFoldScheduled={(scheduledFolded) => updateUiPrefs({ scheduledFolded })}
        onOpenScheduler={() => {
          openView("scheduler");
          setMenu(false);
        }}
        open={menu}
        onNewAgent={() => openSettings({ tab: "agents", agentId: "new" })}
        onOpenAgent={(id) => {
          openAgent(id);
          setMenu(false);
        }}
        onEditAgent={(a) => openSettings({ tab: "agents", agentId: a.id })}
        onRemoveAgent={(a) => setDeleting(a)}
        onNewConversation={(id) => {
          if (id !== agent?.id) updateSettings((s) => ({ ...s, activeAgentId: id }));
          setActiveConversation(null);
          setPendingModel(null);
          setPendingEffort(null);
          setPendingMode(null);
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
        onCollapse={() => updateUiPrefs({ sidebarCollapsed: true })}
      />
      {menu && (
        <button
          type="button"
          className="chat-scrim"
          aria-label={m.chat.closeMenu}
          onClick={() => setMenu(false)}
        />
      )}

      <main className={`chat-main${fresh ? " is-fresh" : ""}${onPage ? " is-page" : ""}`}>
        {!onPage && (
          <header className="chat-top">
            {columnButton}
            {/* Like the plugins' sheets: the conversation is the title, in
                BytNode's ink; who answers is the line under it. */}
            <div className="chat-head">
              {/* Only the conversation's first word (user request); the whole
                  title stays in the tooltip. */}
              <h1 className="chat-title" title={conversation?.title}>
                {conversation ? (conversation.title.trim().split(/\s+/)[0] || conversation.title) : m.chat.newConversation}
              </h1>
              {agent && (
                <p className="chat-sub">
                  <span className="chat-agent">{agent.name}</span>
                  <span className="chat-profession">
                    {m.onboarding.professions[professionInfo(agent.profession).id].label}
                  </span>
                </p>
              )}
            </div>
            {/* Compaction is requested by typing /compact: no button here.
                The badge only flags the testnet — a live account is the
                normal case, not an alert to carry permanently in the header. */}
            {agent && agentAccounts.length > 0 && !anyLive(agentAccounts) && (
              <span className="xch-badge chat-xch" title={m.chat.exchangeAccounts(describeAccounts(agentAccounts))}>
                {m.onboarding.agent.testnet}
              </span>
            )}
            <WidgetsMenu open={widgets.open} editing={widgetsEditing} onEdit={setWidgetsEditing} onAdd={() => setWidgetsGallery(true)} />
          </header>
        )}

        {storageFull && (
          <div className="chat-notice">
            <div className="notice">
              <p>{m.chat.storageFull}</p>
            </div>
          </div>
        )}
        {compactError && compactError.conversationId === active && (
          <div className="chat-notice">
            <div className="notice" role="alert">
              <p>{m.chat.compactFailed(compactError.message)}</p>
              <button type="button" className="btn btn-sm" onClick={() => void send("/compact")} disabled={busy}>
                {m.chat.retry}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={dismissCompactError}>
                {m.common.close}
              </button>
            </div>
          </div>
        )}

        {!onPage && (
          <WidgetsLayer
            settings={settings}
            active={front}
            editing={widgetsEditing && widgets.open}
            onEdit={setWidgetsEditing}
          />
        )}

        {onPage ? (
          <AgentPage
            agent={agent}
            conversations={conversations.filter((c) => c.agentId === agent.id && !c.scheduled).sort((a, b) => b.updatedAt - a.updatedAt)}
            composer={composer}
            columnButton={columnButton}
            onOpenConversation={(id) => {
              openConversation(id);
              setPendingModel(null);
              setPendingEffort(null);
              setPendingMode(null);
            }}
            onPatch={(patch) => patchAgent(agent.id, (a) => ({ ...a, ...patch }))}
            onEdit={() => openSettings({ tab: "agents", agentId: agent.id })}
            onRemove={() => setDeleting(agent)}
          />
        ) : (
          <>
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

            {composer}
            {/* Under the centred composer, the room that sets it a little
                above the middle. */}
            {fresh && <div className="chat-spacer" aria-hidden ref={spacer} />}
          </>
        )}
      </main>

      {!onPage && (
        <UsageMeter
          usage={usage ?? lastUsage}
          rate={rate}
          estimate={contextNow}
          window={currentModel?.contextLength ?? null}
          streaming={busy}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={m.chat.deleteAgentTitle(deleting.name)}
          body={m.chat.deleteAgentBody(conversations.filter((c) => c.agentId === deleting.id).length)}
          confirmLabel={m.common.delete}
          onConfirm={() => {
            removeAgent(deleting);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {widgetsGallery && <WidgetsGallery settings={settings} onClose={closeWidgetsGallery} />}

      {floating}

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
