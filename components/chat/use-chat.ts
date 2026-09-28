"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AgentConfig,
  Conversation,
  Message,
  Settings,
} from "@/lib/domain/types";
import { deriveTitle, newId } from "@/lib/domain/conversation";
import {
  buildCompactRequest,
  compactionMessage,
  isCompactCommand,
  isContextOverflow,
  type CompactedBy,
  transcriptOf,
} from "@/lib/agent/compact";
import { contextEstimate, estimateTokens, mergeUsage, rate, usageState } from "@/lib/agent/usage";
import { withDirectives, type Attachment } from "@/lib/agent/attachments";
import { commandOf } from "@/lib/agent/commands";
import { agentCommandsNow, setAgentCommands } from "@/lib/state/agent-commands";
import type { UsageInfo } from "@/lib/agent/events";
import { matchesRule, ruleFor } from "@/lib/tools/permissions";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { buildToolsPrompt } from "@/lib/agent/tools-prompt";
import type { AgentEvent, Step } from "@/lib/agent/events";
import { pruneToolOutputs, stepsToMessages, type ProviderMessage } from "@/lib/agent/history";
import { runAgentLoop } from "@/lib/agent/loop";
import type { ToolCall } from "@/lib/agent/tool-calls";
import { LlmError, OpenRouterClient } from "@/lib/llm/client";
import { executeTool, fetchToolset } from "@/lib/tools/client";
import { isAlwaysAskTitle, isOpenViewName } from "@/lib/tools/names";
import { openView } from "@/lib/state/tabs";
import { mustAsk, policyIn } from "@/lib/tools/policy";
import { agentTransport } from "@/lib/tools/transport";
import { agentPlugins } from "@/lib/plugins/catalog";
import { currentUserPlugins, runningManifests } from "@/lib/state/user-plugins";
import { fetchPluginPrompt } from "@/lib/plugins/client";
import {
  getConversation,
  patchLastMessage,
  saveConversation,
} from "@/lib/state/conversations";
import { currentSettings } from "@/lib/state/settings";
import { STOPPED, restoreAfterFailedRecovery } from "@/lib/agent/stop";
import { acpAgentOf, acpModelId } from "@/lib/acp/agents";
import {
  AcpError,
  answerAcpPermission,
  closeAcpConversation,
  runAcpTurn,
} from "@/lib/acp/client";
import { buildAcpPrompt } from "@/lib/acp/prompt";
import type { WireEvent } from "@/lib/acp/wire";

/* ---------------------------------------------------------------------------
   Send, receive, act, interrupt.

   The thread lives in the store; this hook runs the agent loop for the
   current turn and translates its events into STEPS of the last message:
   the text that arrives, each tool call, its result. The repository is only
   written at the end of the turn.

   ⚠️ EVENTS ARE BATCHED PER FRAME. A fast model sends dozens per second;
   they accumulate and are applied at once on the next
   `requestAnimationFrame`. Except what waits for an answer — a tool call, a
   permission — applied immediately.

   ⚠️ THE TEXT IS SMOOTHED. Tokens arrive in bursts — forty characters at
   once, then nothing for a fifth of a second — and displayed as is, they
   jump. We keep them in a reserve and reveal a steady share on every frame,
   larger if the reserve grows (we must never fall visibly behind); at the
   end of the stream, whatever remains is applied at once.

   In "ask" mode, a tool that acts (its declared policy, see
   `lib/tools/policy.ts`) shows up with two buttons and the loop waits.
   `answer` decides; "always" records a rule for that call. This mode
   ONLY concerns agents on OpenRouter: a subscription agent has its own
   modes.
   ⚠️ THE MODE AND THE RULES ARE READ AT EVERY TOOL CALL, from the current
   settings — not once per turn. The header's toggle stays live while the
   agent works: switching to "Ask before acting" must stop the very next
   command, not the next turn's (up to 40 model calls later).

   TWO ENGINES, ONE THREAD. An agent on OpenRouter runs our loop right here
   (model + our tools). A subscription agent (`acp:…`) delegates the turn to
   the server, which drives the external agent (Claude Code, Codex, Gemini
   CLI) and sends back the same events — plus that agent's permission
   requests, which take the same buttons.

   ⚠️ CONTEXT MANAGES ITSELF (OpenRouter engine). A turn is a `turn`; `send`
   is only its entry door, and a turn can chain another one:
   - the thread is heavy (meter ≥ 70%) → old tool results are pruned on
     replay (`pruneToolOutputs`), the displayed thread keeps everything;
   - the meter is full (≥ 90%) at the end of the turn → an automatic
     `/compact`, marked as such;
   - the provider refuses the context (`isContextOverflow`) → "hard"
     compaction then replay of the message (or resumption, if the turn had
     already worked). A single recovery per turn: no loop.

   ⚠️ COMPACTION IS A HIDDEN TURN (like in Claude Code). `/compact` adds no
   user message; the model's reply is written into a message flagged
   `compacting`, which the thread shows as a status line "Compacting the
   thread…" and never as a reply. At the end: the summary replaces the whole
   thread (folded, to unfold), or else the line disappears and the failure is
   reported separately (`compactError`), with a way to retry. A voluntary
   stop leaves nothing.
--------------------------------------------------------------------------- */

type Options = {
  settings: Settings;
  agent: AgentConfig;
  conversationId: string | null;
  modelId: string | null;
  effort: string | null;
  /** The external agent's mode (subscriptions) for this turn. */
  mode: string | null;
  /** The model's context window (tokens), to decide on pruning and
      compacting. `null`: unknown, we do not compact on our own. */
  window: number | null;
  onConversationCreated: (id: string) => void;
  /** Memorise an allow rule ("Always") for the agent that ran the turn —
      the one on screen may have changed since. */
  onAllowRule: (agentId: string, rule: string) => void;
};

type ToolStep = Extract<Step, { type: "tool" }>;

/** What goes with a message: dropped attachments, and the deep research
    request. */
export type SendOptions = { attachments?: Attachment[]; research?: boolean; resume?: boolean };

/** What a chained turn knows beyond `send`: who requested the compaction,
    whether to prune hard, whether this is already a recovery (only one),
    and what to replay once compacted. */
type TurnOptions = SendOptions & {
  compactedBy?: CompactedBy;
  hardPrune?: boolean;
  recovered?: boolean;
  thenReplay?: {
    text: string;
    opts: TurnOptions;
    /** The exchange taken out of the thread to compact it (the user's
        message and its empty reply): put back if the compaction fails. */
    taken?: Message[];
  };
  /** Retry after an interrupted reply: no new message — the agent goes on
      IN the reply it had started, from where it stopped. */
  resume?: boolean;
};

/* Pruning: the 6 most recent tool results stay whole, older ones are cut to
   400 characters — or, after an overflow, everything is cut to 200. */
const SOFT_PRUNE = { keep: 6, head: 400 };
const HARD_PRUNE = { keep: 0, head: 200 };
const CONTINUE_PROMPT = "Continue: pick the task up where it stopped, relying on the summary above.";
/* What the model reads (never shown) when the user retries an interrupted
   reply: it sees its own reply so far, and goes on from there. */
const RESUME_PROMPT =
  "Your previous reply was interrupted (connection lost, or stopped by the user). Continue it from exactly where it stopped: do not repeat what you already wrote, and do not redo a tool call that already has a result — rerun only the ones marked interrupted, if still needed.";
const COMPACT_HINT = "Type /compact to summarise the thread, or open a new conversation.";

const STORED_OUTPUT = 12_000;
const STORED_LINES = 200;
/** A sub-agent's report kept in the thread (the call's full output is
    already bounded by STORED_OUTPUT). */
const STORED_REPORT = 6_000;

export function useChat({
  settings,
  agent,
  conversationId,
  modelId,
  effort,
  mode,
  window: contextWindow,
  onConversationCreated,
  onAllowRule,
}: Options) {
  const [streamingId, setStreamingId] = useState<string | null>(null);
  /* One turn at a time — read by `send`, not by chained turns (automatic
     compaction, replay), which follow each other in the same call. */
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const waiting = useRef(
    new Map<string, (allow: boolean, always: boolean) => void>(),
  );
  /* What the turn consumes, for the thread's meter: the last known count
     and the measured rate. Replaced per frame, never mutated. */
  const [live, setLive] = useState<{ usage?: UsageInfo; rate: number | null; produced: number }>({ rate: null, produced: 0 });
  /* A compaction that failed: the thread keeps no trace of it, this is
     where it is reported (and where a retry is offered). */
  const [compactError, setCompactError] = useState<{ conversationId: string; message: string } | null>(null);
  const dismissCompactError = useCallback(() => setCompactError(null), []);

  const stop = useCallback(() => {
    for (const resolve of waiting.current.values()) resolve(false, false);
    waiting.current.clear();
    abort.current?.abort();
  }, []);

  const answer = useCallback((callId: string, allow: boolean, always = false) => {
    /* "Always" no longer flips the agent to direct execution: the
       memorised rule is that of THIS call (see `lib/tools/permissions.ts`),
       and the waiting function is what records it. */
    waiting.current.get(callId)?.(allow, always);
    waiting.current.delete(callId);
  }, []);

  /* Record an "Always" rule: the tool, or the start of the command for a
     shell. A dangerous command, or a tool that always asks, produces no
     rule — `ruleFor` refuses it upstream. */
  const rememberRule = useCallback(
    (agentId: string, name: string, args: Record<string, unknown>, critical: boolean) => {
      const rule = ruleFor(name, args, critical);
      if (rule) onAllowRule(agentId, rule);
    },
    [onAllowRule],
  );

  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      if (!modelId || busy.current) return;
      const turn = async (conversationId: string | null, text: string, opts: TurnOptions): Promise<void> => {
        const joints = opts.attachments ?? [];
        const content = text.trim();
        if (!content && joints.length === 0) return;

        /* A subscription agent's own command (`/goal`, `/usage`, `/model
           haiku`, `$skill`…) goes to it as typed: it runs it as in its
           terminal. The reply remembers which one it answers. */
        const acpNow = acpAgentOf(agent.providerId);
        const own = acpNow ? agentCommandsNow(agent.id, acpNow.id) : [];
        const agentCommand = commandOf(content, own);
        /* `/compact`: the agent summarises the thread, and that summary
           replaces it at the end of the turn. What we send it is not what
           the user typed — it is the summary request. Unless the agent has
           its own `/compact` (Claude Code, Codex): then it compacts its own
           session, as in its terminal. */
        const compact = agentCommand ? null : isCompactCommand(content);
        /* What the model receives: the deep research directive, the
           message, then the attachments note (paths in the workspace). What
           the thread displays stays what the user typed. */
        const prompt = compact
          ? buildCompactRequest(compact.instructions)
          : withDirectives(content, joints, opts.research === true);

        const now = Date.now();
        const stored = conversationId ? getConversation(conversationId) : null;
        /* Nothing to compact: nothing happens (no "/compact" thread). */
        if (compact && !stored?.messages.some((m) => m.content.trim() && !m.compacting)) return;
        busy.current = true;
        if (compact) setCompactError(null);

        /* A compaction left behind by a mid-turn reload no longer has a
           turn to remove it: we do it here. */
        const base: Conversation = stored
          ? { ...stored, messages: stored.messages.filter((m) => !m.compacting) }
          : blank(agent.id, modelId, now);
        const resume = opts.resume === true && base.messages[base.messages.length - 1]?.role === "assistant";
        /* The reply being resumed: its steps so far, its error cleared. */
        const resumed = resume ? base.messages[base.messages.length - 1] : null;
        const user: Message = {
          id: newId(),
          role: "user",
          content: content || (joints.length ? "Look at what I am attaching." : ""),
          createdAt: now,
          ...(joints.length ? { attachments: joints } : {}),
          ...(opts.research ? { research: true } : {}),
        };
        /* Compaction is a hidden turn: no user message, and the reply
           carries `compacting` — the thread shows it as a status line,
           never as a reply. */
        const reply: Message = {
          id: newId(),
          role: "assistant",
          content: "",
          createdAt: now,
          modelId,
          effort: effort ?? undefined,
          steps: [],
          ...(compact ? { compacting: true } : {}),
          ...(agentCommand ? { command: `${agentCommand.command.trigger ?? "/"}${agentCommand.command.name}` } : {}),
        };
        const conversation: Conversation = {
          ...base,
          title: base.messages.length === 0 ? deriveTitle(content) : base.title,
          modelId,
          effort,
          updatedAt: now,
          messages: resumed
            ? [...base.messages.slice(0, -1), { ...resumed, error: undefined }]
            : compact
              ? [...base.messages, reply]
              : [...base.messages, user, reply],
        };
        saveConversation(conversation);
        if (!conversationId) onConversationCreated(conversation.id);

        const controller = new AbortController();
        abort.current = controller;
        /* This agent as the settings hold it NOW (see the header note):
           its mode and its rules can change during the turn. */
        const liveAgent = (): AgentConfig => currentSettings().agents.find((a) => a.id === agent.id) ?? agent;
        setStreamingId(conversation.id);

        /* The steps of the current message, held here and applied per
           frame — a resumed reply starts from the ones it has. */
        const steps: Step[] = (resumed?.steps ?? []).map((s) => (s.type === "tool" ? { ...s, lines: s.lines?.slice() } : { ...s }));
        /* New text after a resume opens its own block, never glued to the
           last sentence before the cut. */
        const kept = steps.length;
        let dirty = false;
        let frame = 0;
        /* The reserve of text not yet revealed, and its pace. */
        let reserve = "";
        const reveal = (all = false) => {
          if (!reserve) return;
          /* A frame = ~16 ms. We aim to drain the reserve in ~150 ms, with
             a minimum of two characters per frame, without exceeding what
             we have. */
          const n = all
            ? reserve.length
            : Math.min(
                reserve.length,
                Math.max(2, Math.ceil(reserve.length / 9)),
              );
          const piece = reserve.slice(0, n);
          reserve = reserve.slice(n);
          const last = steps.length > kept ? steps[steps.length - 1] : undefined;
          if (last?.type === "text") last.text += piece;
          else steps.push({ type: "text", text: piece });
          dirty = true;
        };
        const flush = () => {
          frame = 0;
          reveal();
          if (dirty) {
            dirty = false;
            const snapshot = steps.map((s) =>
              s.type === "tool" ? { ...s, lines: s.lines?.slice() } : { ...s },
            );
            patchLastMessage(conversation.id, (m) => ({
              ...m,
              steps: snapshot,
              content: textOf(snapshot),
            }));
          }
          /* As long as text remains in reserve, we carry on frame by frame. */
          if (reserve && !frame) frame = requestAnimationFrame(flush);
        };
        const mark = (immediate = false) => {
          dirty = true;
          if (immediate) {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            reveal(true);
            flush();
          } else if (!frame) frame = requestAnimationFrame(flush);
        };
        const tool = (id: string) =>
          steps.find((s): s is ToolStep => s.type === "tool" && s.id === id);

        const acp = acpAgentOf(agent.providerId);
        /* The turn's count, and the rate: tokens produced since the first
           character, measured on every frame.
           ⚠️ The COST adds up over the turn's model calls: OpenRouter prices
           each request, and a turn with ten tool calls is eleven requests
           (a resumed reply starts from what it had already cost). A
           subscription agent's `usage_update` already carries a running
           total: replaced, never added. The tokens are always the last
           call's — they are what the context meter shows. */
        let usage: UsageInfo | undefined = acp ? undefined : resumed?.usage;
        let produced = 0;
        let firstAt = 0;
        const pushLive = () => {
          const r = firstAt ? rate(produced, Date.now() - firstAt) : null;
          setLive({ usage, rate: r, produced });
        };

        const emit = (e: AgentEvent) => {
          switch (e.type) {
            case "usage":
              usage = mergeUsage(usage, e.usage, { addCost: !acp });
              pushLive();
              break;
            case "retry":
              reserve += `

_${e.reason} — retrying ${e.attempt}/${e.of}…_

`;
              if (!frame) frame = requestAnimationFrame(flush);
              break;
            case "thought": {
              const last = steps[steps.length - 1];
              if (last?.type === "thought") last.text += e.text;
              else steps.push({ type: "thought", text: e.text });
              mark();
              break;
            }
            case "plan": {
              const i = steps.findIndex((x) => x.type === "plan");
              if (i >= 0) steps[i] = { type: "plan", entries: e.entries };
              else steps.push({ type: "plan", entries: e.entries });
              mark(true);
              break;
            }
            case "text":
              if (!firstAt) firstAt = Date.now();
              produced += estimateTokens(e.text);
              pushLive();
              reserve += e.text;
              if (!frame) frame = requestAnimationFrame(flush);
              break;
            case "tool_call":
              /* The text in reserve precedes the call: apply it first. */
              reveal(true);
              steps.push({
                type: "tool",
                id: e.id,
                name: e.name,
                args: e.args,
                status: "running",
              });
              mark(true);
              break;
            case "tool_line": {
              const t = tool(e.id);
              if (t) {
                t.lines = [...(t.lines ?? []), e.line].slice(-STORED_LINES);
                mark();
              }
              break;
            }
            case "subagent": {
              /* The id is `<call>:<index>`: the sub-agent's state is filed
                 on the Workflow call, at its index. The report is bounded
                 like a tool output. */
              const t = tool(e.id.slice(0, e.id.lastIndexOf(":")));
              if (t) {
                const report =
                  e.report && e.report.length > STORED_REPORT
                    ? `${e.report.slice(0, STORED_REPORT)}\n[…]`
                    : e.report;
                const state = { index: e.index, title: e.title, profession: e.profession, status: e.status, report };
                t.subagents = [
                  ...(t.subagents ?? []).filter((s) => s.index !== e.index),
                  state,
                ].sort((a, b) => a.index - b.index);
                mark(true);
              }
              break;
            }
            case "tool_result": {
              const t = tool(e.id);
              if (t) {
                t.status =
                  t.status === "denied" ? "denied" : e.ok ? "done" : "failed";
                t.output =
                  e.output.length > STORED_OUTPUT
                    ? `${e.output.slice(0, STORED_OUTPUT)}\n[…]`
                    : e.output;
                if (e.images?.length) t.images = e.images;
                if (e.card) t.card = e.card;
                /* The agent opened a view: the tab opens (or comes to the
                   front) now — the live event only, never a replay. */
                if (e.ok && isOpenViewName(t.name) && typeof t.args.view === "string") {
                  const params = t.args.params;
                  openView(t.args.view, typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : undefined);
                }
                mark(true);
              }
              break;
            }
            case "error":
            case "done":
              break;
          }
        };

        let error: string | undefined;
        let caught: unknown;
        try {
          /* What THIS agent's requests carry: the keys, the exchange
             accounts it may drive (they decide which tools it sees). */
          const transport = agentTransport(settings, agent, agentPlugins(settings, agent.id, runningManifests(currentUserPlugins())));
          const exchangeAccounts = transport.exchangeAccounts;
          const unattachedExchanges = settings.keys.exchanges.length - exchangeAccounts.length;
          /* What the agent's plugins add to its prompt (its watchlist, the
             coming events…) is re-read at every turn, like the memory. */
          const [toolset, memory, plugged] = await Promise.all([
            fetchToolset(agent.id, agent.workspace ?? "", agent.profession, transport),
            fetchMemory(agent.id, agent.workspace ?? ""),
            fetchPluginPrompt(agent.id, acp ? "mcp" : "native", transport),
          ]);
          if (acp) {
            /* --- By subscription: the server drives the external agent. --- */
            const system = [
              buildSystemPrompt(settings.profile, agent),
              toolset.profession.prompt,
              buildAcpPrompt(
                toolset.workspace,
                toolset.skills,
                toolset.bytnode,
                acp.product,
                exchangeAccounts,
                unattachedExchanges,
              ),
              plugged,
              memory,
            ]
              .filter(Boolean)
              .join("\n\n");
            /* What precedes this turn: without the reply in progress, nor
               the user's message (a compaction has none). */
            const previous = resume ? conversation.messages : conversation.messages.slice(0, compact ? -1 : -2);
            /* The tools that always ask beyond the core's floor, to
               recognise them in an external agent's call title. */
            const critical = Object.entries(toolset.policies ?? {})
              .filter(([, p]) => p.alwaysAsk)
              .map(([name]) => name);
            const onEvent = (e: WireEvent) => {
              switch (e.type) {
                case "session": {
                  const c = getConversation(conversation.id);
                  if (c && c.acpSessionId !== e.sessionId)
                    saveConversation({ ...c, acpSessionId: e.sessionId });
                  break;
                }
                /* The agent's own commands, for the composer. */
                case "commands":
                  setAgentCommands(agent.id, e.commands);
                  break;
                /* The session changed by itself (`/model haiku`, `/effort
                   low`, the agent leaving its plan mode): the
                   conversation's pickers follow, so the next turn keeps it. */
                case "agent_config": {
                  const c = getConversation(conversation.id);
                  if (!c) break;
                  const next = {
                    ...c,
                    ...(e.modelId ? { modelId: e.modelId } : {}),
                    ...(e.effort ? { effort: e.effort } : {}),
                    ...(e.mode ? { mode: e.mode } : {}),
                  };
                  if (next.modelId !== c.modelId || next.effort !== c.effort || next.mode !== c.mode) saveConversation(next);
                  break;
                }
                case "tool_update": {
                  const t = tool(e.id);
                  if (t) {
                    if (e.name) t.name = e.name;
                    if (e.args) t.args = e.args;
                    if (e.line)
                      t.lines = [...(t.lines ?? []), ...e.line.split("\n")].slice(
                        -STORED_LINES,
                      );
                    mark(true);
                  }
                  break;
                }
                case "permission": {
                  let t = tool(e.id);
                  if (!t) {
                    reveal(true);
                    t = {
                      type: "tool",
                      id: e.id,
                      name: e.title || "Tool",
                      args: { title: e.title },
                      status: "pending",
                    };
                    steps.push(t);
                  } else t.status = "pending";
                  if (isAlwaysAskTitle(e.title, critical)) t.alwaysAsk = true;
                  mark(true);
                  waiting.current.set(e.id, (allow, always) => {
                    const step = tool(e.id);
                    if (step) step.status = allow ? "running" : "denied";
                    if (allow && always && step) rememberRule(agent.id, step.name, step.args, step.alwaysAsk === true);
                    mark(true);
                    void answerAcpPermission(
                      conversation.id,
                      e.id,
                      allow,
                      always,
                      e.nonce,
                    );
                  });
                  break;
                }
                default:
                  emit(e);
              }
            };
            await runAcpTurn(
              {
                conversationId: conversation.id,
                agent: acp.id,
                agentId: agent.id,
                workspace: agent.workspace ?? "",
                profession: agent.profession,
                system,
                text: resume ? RESUME_PROMPT : prompt,
                images: joints.filter((a) => a.kind === "image" && a.dataUrl).map((a) => a.dataUrl as string),
                modelId: acpModelId(modelId),
                effort,
                mode,
                /* A subscription agent has its own modes (Plan, Don't ask,
                   Bypass…): when it asks anyway, the request is put on
                   screen — we do not decide for it. */
                permissionMode: "ask",
                sessionId: base.acpSessionId ?? null,
                firstTurn: previous.length === 0,
                history: previous.length > 0 ? transcriptOf(previous) : undefined,
                transport,
              },
              onEvent,
              controller.signal,
            );
          } else {
            const system = [
              buildSystemPrompt(settings.profile, agent),
              toolset.profession.prompt,
              buildToolsPrompt(
                toolset.workspace,
                toolset.skills,
                toolset.platform,
                agent.scope ?? "workspace",
                toolset.bytnode,
                exchangeAccounts,
                unattachedExchanges,
              ),
              plugged,
              memory,
            ]
              .filter(Boolean)
              .join("\n\n");
            const history: ProviderMessage[] = [
              { role: "system", content: system },
              ...(resume ? conversation.messages : conversation.messages.slice(0, -1))
                .filter((m) => m.content.length > 0 || (m.steps?.length ?? 0) > 0)
                .flatMap(stepsToMessages),
            ];
            /* What the model reads is not always what the user typed. A
               compaction has no user message in the thread: the summary
               request is added here, at the tail. A message with
               attachments or deep research is already in `history`, but
               additionally carries the paths note and the directive. The
               images, for their part, stay. */
            if (compact) history.push({ role: "user", content: prompt });
            else if (resume) history.push({ role: "user", content: RESUME_PROMPT });
            else if (prompt !== content) {
              const dernier = history[history.length - 1];
              if (dernier?.role === "user") {
                history[history.length - 1] = Array.isArray(dernier.content)
                  ? {
                      role: "user",
                      content: dernier.content.map((part) => (part.type === "text" ? { type: "text" as const, text: prompt } : part)),
                    }
                  : { role: "user", content: prompt };
              }
            }
            /* Is the thread heavy? Old tool results leave pruned. We judge
               on the last exact count, otherwise on an estimate. */
            const lastUsage = [...base.messages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage;
            const before = usageState(lastUsage, contextWindow, contextEstimate(conversation.messages));
            const replay = opts.hardPrune ? pruneToolOutputs(history, HARD_PRUNE) : before.level !== "ok" ? pruneToolOutputs(history, SOFT_PRUNE) : history;
            const client = new OpenRouterClient(settings.keys.openrouter);
            const exec = {
              agentId: agent.id,
              workspace: toolset.workspace,
              model: modelId,
              effort,
              scope: agent.scope ?? "workspace",
              profession: agent.profession,
              transport,
            };
            await runAgentLoop(replay, {
              complete: (messages, tools, signal) =>
                client.streamChat({
                  model: modelId,
                  messages,
                  tools,
                  effort,
                  signal,
                }),
              execute: (call, signal, em) => executeTool(call, exec, signal, em),
              /* A tool that acts goes through the user's permission — except
                 in direct execution, or if an already memorised rule covers
                 it (`Write`, `Bash(git status *)`…). What commits funds
                 always asks. The policy is the one each tool declares
                 (`lib/tools/policy.ts`). */
              gated: (name) => mustAsk(policyIn(toolset.policies, name), liveAgent().permissionMode === "skip"),
              permission: (call: ToolCall) =>
                new Promise<boolean>((resolve) => {
                  const critical = policyIn(toolset.policies, call.name).alwaysAsk;
                  if (matchesRule(liveAgent().allowRules, call.name, call.args, critical)) {
                    resolve(true);
                    return;
                  }
                  const t = tool(call.id);
                  if (t) {
                    t.status = "pending";
                    if (critical) t.alwaysAsk = true;
                  }
                  mark(true);
                  waiting.current.set(call.id, (allow, always) => {
                    const step = tool(call.id);
                    if (step) step.status = allow ? "running" : "denied";
                    mark(true);
                    if (allow && always) rememberRule(agent.id, call.name, call.args, critical);
                    resolve(allow);
                  });
                }),
              emit,
              tools: toolset.tools,
              signal: controller.signal,
            });
          }
        } catch (e) {
          caught = e;
          if (controller.signal.aborted) error = undefined;
          else if (e instanceof LlmError || e instanceof AcpError)
            error = e.message;
          else
            error =
              e instanceof Error && e.message
                ? e.message
                : "The reply was interrupted. Check your connection.";
        } finally {
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          reveal(true);
          flush();
          waiting.current.clear();
          abort.current = null;
          setStreamingId(null);
          busy.current = false;
        }

        const finished = getConversation(conversation.id);
        if (!finished) return;
        const last = finished.messages[finished.messages.length - 1];
        const stopped =
          controller.signal.aborted &&
          last.content.length === 0 &&
          (last.steps?.length ?? 0) === 0;
        /* Stopped with something written: kept, and marked as stopped (the
           thread offers to continue it — see `lib/agent/stop.ts`). */
        if (controller.signal.aborted && !stopped && !compact) error = STOPPED;
        const closed = (m: Message): Message => ({
          ...m,
          error,
          ...(usage ? { usage } : {}),
          steps: m.steps?.map((s) =>
            s.type === "tool" &&
            (s.status === "running" || s.status === "pending")
              ? { ...s, status: "failed", output: s.output ?? "[interrupted]" }
              : s,
          ),
        });
        /* Compaction: the status line never survives the turn. Successful,
           the summary replaces the whole thread — for a subscription agent,
           its session is closed, the next one will start again from the
           summary instead of the full history. Stopped, nothing remains.
           Failed, the error is reported separately, with a way to retry. */
        if (compact) {
          const aborted = controller.signal.aborted;
          const summary = last.content.trim();
          if (!error && !aborted && summary) {
            if (acp) void closeAcpConversation(conversation.id);
            saveConversation({
              ...finished,
              updatedAt: Date.now(),
              acpSessionId: undefined,
              messages: [compactionMessage(summary, newId(), Date.now(), opts.compactedBy ?? "user")],
            });
            /* The compaction turn's count measured the OLD thread: the
               meter starts again from the new one's estimate. */
            setLive({ rate: null, produced: 0 });
            if (opts.thenReplay) await turn(conversation.id, opts.thenReplay.text, opts.thenReplay.opts);
            return;
          }
          const taken = opts.thenReplay?.taken;
          if (taken?.length) {
            /* This compaction was the recovery of an overflow that had taken
               the user's message out of the thread: it comes back, with
               why, instead of vanishing. Retry sends it again. */
            const why = aborted
              ? `The context window is full and compacting the thread was stopped. ${COMPACT_HINT}`
              : `The context window is full and compacting the thread failed: ${error ?? "the agent produced no summary."} ${COMPACT_HINT}`;
            saveConversation({ ...finished, updatedAt: Date.now(), messages: restoreAfterFailedRecovery(finished.messages, taken, why) });
            return;
          }
          saveConversation({ ...finished, updatedAt: Date.now(), messages: finished.messages.slice(0, -1) });
          if (aborted) return;
          /* The summary request itself overflows the context: once, pruning
             hard every replayed tool result. */
          if (!acp && !opts.hardPrune && isContextOverflow(caught)) {
            await turn(conversation.id, text, { ...opts, hardPrune: true });
            return;
          }
          const why = error ?? "The agent produced no summary.";
          setCompactError({
            conversationId: conversation.id,
            message: opts.compactedBy && opts.compactedBy !== "user" ? `${why} ${COMPACT_HINT}` : why,
          });
          return;
        }

        /* The provider refused the context: we compact "hard", then replay.
           A turn that had produced nothing is removed and its message sent
           again as is; a turn that had already worked stays (the summary
           covers the "In progress") and the task resumes. */
        const worked = last.content.length > 0 || (last.steps?.length ?? 0) > 0;
        const overflow =
          !acp && !stopped && !opts.recovered && isContextOverflow(caught) && (worked || finished.messages.length > 2);
        if (overflow) {
          const replay: TurnOptions = worked
            ? { recovered: true }
            : { attachments: joints, research: opts.research, recovered: true };
          if (worked) error = "Context window exceeded mid-task: the thread is compacted, then the task resumes.";
          saveConversation({
            ...finished,
            updatedAt: Date.now(),
            messages: worked
              ? finished.messages.map((m, i) => (i === finished.messages.length - 1 ? closed(m) : m))
              : finished.messages.slice(0, -2),
          });
          await turn(conversation.id, "/compact", {
            compactedBy: "overflow",
            hardPrune: true,
            recovered: true,
            thenReplay: {
              text: worked ? CONTINUE_PROMPT : content,
              opts: replay,
              ...(worked ? {} : { taken: finished.messages.slice(-2) }),
            },
          });
          return;
        }

        saveConversation({
          ...finished,
          updatedAt: Date.now(),
          messages: stopped
            ? finished.messages.slice(0, -1)
            : finished.messages.map((m, i) =>
                i === finished.messages.length - 1 ? closed(m) : m,
              ),
        });

        /* Meter full at the end of a clean turn: we compact while the user
           reads, rather than making them wait at the next message. */
        if (!acp && !error && !stopped) {
          const after = usageState(usage, contextWindow, contextEstimate(getConversation(conversation.id)?.messages ?? []));
          if (after.level === "full") await turn(conversation.id, "/compact", { compactedBy: "auto" });
        }
        };
      return turn(conversationId, text, opts);
    },
    [
      settings,
      agent,
      conversationId,
      modelId,
      effort,
      mode,
      contextWindow,
      onConversationCreated,
      rememberRule,
    ],
  );

  /* Retry after an error, like Claude: a reply that had started stays on
     screen and the agent goes on IN it, from where it stopped (it reads
     its own partial reply). A reply that had produced nothing is removed
     and the question sent again. */
  const retry = useCallback(() => {
    if (!conversationId || streamingId) return;
    const c = getConversation(conversationId);
    if (!c) return;
    const last = c.messages[c.messages.length - 1];
    if (!last?.error || last.role !== "assistant") return;
    if (last.content.trim() || (last.steps?.length ?? 0) > 0) {
      void send(RESUME_PROMPT, { resume: true });
      return;
    }
    const question = c.messages[c.messages.length - 2];
    if (question?.role !== "user") return;
    saveConversation({ ...c, messages: c.messages.slice(0, -2) });
    void send(question.content, { attachments: question.attachments, research: question.research });
  }, [conversationId, streamingId, send]);

  return {
    send,
    stop,
    retry,
    answer,
    streamingId,
    usage: live.usage,
    rate: live.rate,
    produced: live.produced,
    compactError,
    dismissCompactError,
  };
}

/* The agent's memory, re-read on every turn (it changes during the
   conversation). Without a server, no memory — never blocking. */
async function fetchMemory(
  agentId: string,
  workspace: string,
): Promise<string> {
  try {
    const res = await fetch(
      `/api/memory?agentId=${encodeURIComponent(agentId)}&workspace=${encodeURIComponent(workspace)}`,
    );
    const json = (await res.json()) as { prompt?: string };
    return res.ok ? (json.prompt ?? "") : "";
  } catch {
    return "";
  }
}

const textOf = (steps: Step[]) =>
  steps.map((s) => (s.type === "text" ? s.text : "")).join("");

const blank = (
  agentId: string,
  modelId: string,
  now: number,
): Conversation => ({
  id: newId(),
  agentId,
  title: "New conversation",
  modelId,
  createdAt: now,
  updatedAt: now,
  messages: [],
});
