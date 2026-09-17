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
import { alwaysAsks, isGated } from "@/lib/tools/names";
import { allowedAccounts } from "@/lib/tools/exchange/accounts";
import {
  getConversation,
  patchLastMessage,
  saveConversation,
} from "@/lib/state/conversations";
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
   Envoyer, recevoir, agir, interrompre.

   Le fil vit dans le magasin ; ce crochet fait tourner la boucle de l'agent
   pour le tour en cours et traduit ses evenements en PAS du dernier
   message : le texte qui arrive, chaque appel d'outil, son resultat. Le
   depot n'est ecrit qu'a la fin du tour.

   ⚠️ LES EVENEMENTS SONT GROUPES PAR IMAGE. Un modele rapide en envoie des
   dizaines par seconde ; ils s'accumulent et sont poses en une fois au
   prochain `requestAnimationFrame`. Sauf ce qui attend une reponse — un
   appel d'outil, une permission — pose tout de suite.

   ⚠️ LE TEXTE EST LISSE. Les jetons arrivent par rafales — quarante
   caracteres d'un coup, puis rien pendant un cinquieme de seconde — et
   affiches tels quels, ils sautent. On les garde dans une reserve et on en
   revele une part reguliere a chaque image, plus grande si la reserve
   grossit (on ne doit jamais prendre de retard visible) ; a la fin du flux,
   tout ce qui reste est pose d'un coup.

   En mode « demander », un outil qui agit (voir `GATED_TOOLS`) s'affiche
   avec deux boutons et la boucle attend. `answer` tranche ; « toujours »
   bascule l'agent en mode direct. Ce mode ne concerne QUE les agents sur
   OpenRouter : un agent par abonnement a ses propres modes.

   DEUX MOTEURS, UN SEUL FIL. Un agent sur OpenRouter fait tourner notre
   boucle ici meme (modele + nos outils). Un agent par abonnement
   (`acp:…`) delegue le tour au serveur, qui pilote l'agent externe (Claude
   Code, Codex, Gemini CLI) et renvoie les memes evenements — plus les
   demandes de permission de cet agent, qui prennent les memes boutons.

   ⚠️ LE CONTEXTE SE GERE TOUT SEUL (moteur OpenRouter). Un tour est un
   `turn` ; `send` n'en est que la porte d'entree, et un tour peut en
   enchainer un autre :
   - le fil pese (jauge ≥ 70 %) → les vieux resultats d'outils sont elagues
     au rejeu (`pruneToolOutputs`), le fil affiche garde tout ;
   - la jauge est pleine (≥ 90 %) en fin de tour → un `/compact`
     automatique, marque comme tel ;
   - le fournisseur refuse le contexte (`isContextOverflow`) → compaction
     « dure » puis rejeu du message (ou reprise, si le tour avait deja
     travaille). Une seule recuperation par tour : pas de boucle.

   ⚠️ LE COMPACTAGE EST UN TOUR CACHE (comme dans Claude Code). `/compact`
   n'ajoute pas de message de l'utilisateur ; la reponse du modele s'ecrit
   dans un message marque `compacting`, que le fil montre comme une ligne
   d'etat « Compactage du fil… » et jamais comme une reponse. A la fin :
   le resume remplace tout le fil (replie, a deplier), ou bien la ligne
   disparait et l'echec est dit a part (`compactError`), avec de quoi
   reessayer. Un arret volontaire ne laisse rien.
--------------------------------------------------------------------------- */

type Options = {
  settings: Settings;
  agent: AgentConfig;
  conversationId: string | null;
  modelId: string | null;
  effort: string | null;
  /** Le mode de l'agent externe (abonnements) pour ce tour. */
  mode: string | null;
  /** La fenetre de contexte du modele (jetons), pour decider d'elaguer
      et de compacter. `null` : inconnue, on ne compacte pas tout seul. */
  window: number | null;
  onConversationCreated: (id: string) => void;
  /** Memoriser une regle d'autorisation pour cet agent (« Toujours »). */
  onAllowRule: (rule: string) => void;
};

type ToolStep = Extract<Step, { type: "tool" }>;

/** Ce qui accompagne un message : pieces jointes deposees, et la demande de
    recherche approfondie. */
export type SendOptions = { attachments?: Attachment[]; research?: boolean };

/** Ce qu'un tour enchaine sait de plus que `send` : qui a demande la
    compaction, s'il faut elaguer fort, s'il s'agit deja d'une
    recuperation (une seule), et quoi rejouer une fois compacte. */
type TurnOptions = SendOptions & {
  compactedBy?: CompactedBy;
  hardPrune?: boolean;
  recovered?: boolean;
  thenReplay?: { text: string; opts: TurnOptions };
};

/* L'elagage : les 6 derniers resultats d'outils restent entiers, les
   anciens sont reduits a 400 caracteres — ou, apres un debordement, tout
   est reduit a 200. */
const SOFT_PRUNE = { keep: 6, head: 400 };
const HARD_PRUNE = { keep: 0, head: 200 };
const CONTINUE_PROMPT = "Continue : reprends la tâche où elle s'est arrêtée, en t'appuyant sur le résumé ci-dessus.";
const COMPACT_HINT = "Tapez /compact pour résumer le fil, ou ouvrez une nouvelle conversation.";

const STORED_OUTPUT = 12_000;
const STORED_LINES = 200;
/** Le rapport d'un sous-agent garde dans le fil (la sortie complete de
    l'appel, elle, est deja bornee par STORED_OUTPUT). */
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
  /* Un tour a la fois — lu par `send`, pas par les tours enchaines (la
     compaction automatique, le rejeu), qui se suivent dans le meme appel. */
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const waiting = useRef(
    new Map<string, (allow: boolean, always: boolean) => void>(),
  );
  const skipAll = useRef(false);
  /* Ce que le tour consomme, pour la jauge du fil : le dernier decompte
     connu et le debit mesure. Remplace par image, jamais mute. */
  const [live, setLive] = useState<{ usage?: UsageInfo; rate: number | null; produced: number }>({ rate: null, produced: 0 });
  /* Un compactage qui a echoue : le fil n'en garde aucune trace, c'est ici
     qu'on le dit (et qu'on propose de reessayer). */
  const [compactError, setCompactError] = useState<{ conversationId: string; message: string } | null>(null);
  const dismissCompactError = useCallback(() => setCompactError(null), []);

  const stop = useCallback(() => {
    for (const resolve of waiting.current.values()) resolve(false, false);
    waiting.current.clear();
    abort.current?.abort();
  }, []);

  const answer = useCallback((callId: string, allow: boolean, always = false) => {
    /* « Toujours » ne bascule plus l'agent en execution directe : la regle
       memorisee est celle de CET appel (voir `lib/tools/permissions.ts`), et
       c'est la fonction d'attente qui l'enregistre. */
    waiting.current.get(callId)?.(allow, always);
    waiting.current.delete(callId);
  }, []);

  /* Enregistrer une regle « Toujours » : l'outil, ou le debut de la
     commande pour un shell. Une commande dangereuse ne produit pas de
     regle — `ruleFor` la refuse en amont. */
  const rememberRule = useCallback(
    (name: string, args: Record<string, unknown>) => {
      const rule = ruleFor(name, args);
      if (rule) onAllowRule(rule);
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

        /* `/compact` : l'agent resume le fil, et ce resume le remplace a la
           fin du tour. Ce qu'on lui envoie n'est pas ce que l'utilisateur a
           tape — c'est la demande de resume. */
        const compact = isCompactCommand(content);
        /* Ce que le modele recoit : la consigne de recherche approfondie, le
           message, puis la note des pieces jointes (chemins dans le dossier de
           travail). Ce que le fil affiche reste ce que l'utilisateur a tape. */
        const prompt = compact
          ? buildCompactRequest(compact.instructions)
          : withDirectives(content, joints, opts.research === true);

        const now = Date.now();
        const stored = conversationId ? getConversation(conversationId) : null;
        /* Rien a compacter : rien ne se passe (pas de fil « /compact »). */
        if (compact && !stored?.messages.some((m) => m.content.trim() && !m.compacting)) return;
        busy.current = true;
        if (compact) setCompactError(null);

        /* Un compactage laisse la par un rechargement en plein milieu n'a
           plus de tour pour le retirer : on le fait ici. */
        const base: Conversation = stored
          ? { ...stored, messages: stored.messages.filter((m) => !m.compacting) }
          : blank(agent.id, modelId, now);
        const user: Message = {
          id: newId(),
          role: "user",
          content: content || (joints.length ? "Regarde ce que je te joins." : ""),
          createdAt: now,
          ...(joints.length ? { attachments: joints } : {}),
          ...(opts.research ? { research: true } : {}),
        };
        /* Le compactage est un tour cache : pas de message de l'utilisateur,
           et la reponse porte `compacting` — le fil la montre comme une
           ligne d'etat, jamais comme une reponse. */
        const reply: Message = {
          id: newId(),
          role: "assistant",
          content: "",
          createdAt: now,
          modelId,
          effort: effort ?? undefined,
          steps: [],
          ...(compact ? { compacting: true } : {}),
        };
        const conversation: Conversation = {
          ...base,
          title: base.messages.length === 0 ? deriveTitle(content) : base.title,
          modelId,
          effort,
          updatedAt: now,
          messages: compact ? [...base.messages, reply] : [...base.messages, user, reply],
        };
        saveConversation(conversation);
        if (!conversationId) onConversationCreated(conversation.id);

        const controller = new AbortController();
        abort.current = controller;
        skipAll.current = agent.permissionMode === "skip";
        setStreamingId(conversation.id);

        /* Les pas du message en cours, tenus ici et poses par image. */
        const steps: Step[] = [];
        let dirty = false;
        let frame = 0;
        /* La reserve de texte pas encore revele, et son rythme. */
        let reserve = "";
        const reveal = (all = false) => {
          if (!reserve) return;
          /* Une image = ~16 ms. On vise a ecouler la reserve en ~150 ms,
             avec un minimum de deux caracteres par image, sans depasser ce
             qu'on a. */
          const n = all
            ? reserve.length
            : Math.min(
                reserve.length,
                Math.max(2, Math.ceil(reserve.length / 9)),
              );
          const piece = reserve.slice(0, n);
          reserve = reserve.slice(n);
          const last = steps[steps.length - 1];
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
          /* Tant qu'il reste du texte en reserve, on continue image par image. */
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

        /* Le decompte du tour, et le debit : jetons produits depuis le
           premier caractere, mesures a chaque image. */
        let usage: UsageInfo | undefined;
        let produced = 0;
        let firstAt = 0;
        const pushLive = () => {
          const r = firstAt ? rate(produced, Date.now() - firstAt) : null;
          setLive({ usage, rate: r, produced });
        };

        const emit = (e: AgentEvent) => {
          switch (e.type) {
            case "usage":
              usage = mergeUsage(usage, e.usage);
              pushLive();
              break;
            case "retry":
              reserve += `

_${e.reason} — nouvelle tentative ${e.attempt}/${e.of}…_

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
              /* Le texte en reserve precede l'appel : on le pose avant. */
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
              /* L'id est `<appel>:<index>` : l'etat du sous-agent se range
                 sur l'appel Workflow, a son index. Le rapport est borne
                 comme une sortie d'outil. */
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
        const acp = acpAgentOf(agent.providerId);
        try {
          /* Les comptes exchange que CET agent peut piloter : ils partent
             avec chaque requete d'outil, et decident des outils qu'il voit. */
          const exchangeAccounts = allowedAccounts(settings.keys.exchanges, agent.exchangeAccountIds);
          const unattachedExchanges = settings.keys.exchanges.length - exchangeAccounts.length;
          const [toolset, memory] = await Promise.all([
            fetchToolset(
              agent.id,
              agent.workspace ?? "",
              agent.profession,
              settings.keys.bytnode,
              exchangeAccounts,
            ),
            fetchMemory(agent.id, agent.workspace ?? ""),
          ]);
          if (acp) {
            /* --- Par abonnement : le serveur pilote l'agent externe. --- */
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
              memory,
            ]
              .filter(Boolean)
              .join("\n\n");
            /* Ce qui precede ce tour : sans la reponse en cours, ni le
               message de l'utilisateur (un compactage n'en a pas). */
            const previous = conversation.messages.slice(0, compact ? -1 : -2);
            const onEvent = (e: WireEvent) => {
              switch (e.type) {
                case "session": {
                  const c = getConversation(conversation.id);
                  if (c && c.acpSessionId !== e.sessionId)
                    saveConversation({ ...c, acpSessionId: e.sessionId });
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
                      name: e.title || "Outil",
                      args: { title: e.title },
                      status: "pending",
                    };
                    steps.push(t);
                  } else t.status = "pending";
                  mark(true);
                  waiting.current.set(e.id, (allow, always) => {
                    const step = tool(e.id);
                    if (step) step.status = allow ? "running" : "denied";
                    if (allow && always && step) rememberRule(step.name, step.args);
                    mark(true);
                    void answerAcpPermission(
                      conversation.id,
                      e.id,
                      allow,
                      always,
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
                text: prompt,
                images: joints.filter((a) => a.kind === "image" && a.dataUrl).map((a) => a.dataUrl as string),
                modelId: acpModelId(modelId),
                effort,
                mode,
                /* Un agent par abonnement a ses propres modes (Plan, Ne pas
                   demander, Contourner…) : quand il demande malgre tout, la
                   demande est posee a l'ecran — on ne tranche pas pour lui. */
                permissionMode: "ask",
                sessionId: base.acpSessionId ?? null,
                firstTurn: previous.length === 0,
                history: previous.length > 0 ? transcriptOf(previous) : undefined,
                bytnodeKey: settings.keys.bytnode,
                exchangeAccounts,
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
              memory,
            ]
              .filter(Boolean)
              .join("\n\n");
            const history: ProviderMessage[] = [
              { role: "system", content: system },
              ...conversation.messages
                .slice(0, -1)
                .filter((m) => m.content.length > 0 || (m.steps?.length ?? 0) > 0)
                .flatMap(stepsToMessages),
            ];
            /* Ce que le modele lit n'est pas toujours ce que l'utilisateur a
               tape. Un compactage n'a pas de message de l'utilisateur dans le
               fil : la demande de resume s'ajoute ici, en queue. Un message
               avec pieces jointes ou recherche approfondie est deja dans
               `history`, mais porte en plus la note des chemins et la
               consigne. Les images, elles, restent. */
            if (compact) history.push({ role: "user", content: prompt });
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
            /* Le fil pese ? Les vieux resultats d'outils partent elagues. On
               juge sur le dernier decompte exact, sinon sur une estimation. */
            const lastUsage = [...base.messages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage;
            const before = usageState(lastUsage, contextWindow, contextEstimate(conversation.messages));
            const replay = opts.hardPrune ? pruneToolOutputs(history, HARD_PRUNE) : before.level !== "ok" ? pruneToolOutputs(history, SOFT_PRUNE) : history;
            const client = new OpenRouterClient(settings.keys.openrouter);
            const exec = {
              apiKey: settings.keys.openrouter,
              agentId: agent.id,
              workspace: toolset.workspace,
              model: modelId,
              effort,
              scope: agent.scope ?? "workspace",
              profession: agent.profession,
              bytnodeKey: settings.keys.bytnode,
              exchangeAccounts,
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
              /* Un outil qui agit passe par l'accord de l'utilisateur — sauf
                 en execution directe, ou si une regle deja memorisee le
                 couvre (`Write`, `Bash(git status *)`…). */
              gated: (name) => alwaysAsks(name) || (!skipAll.current && isGated(name)),
              permission: (call: ToolCall) =>
                new Promise<boolean>((resolve) => {
                  if (matchesRule(agent.allowRules, call.name, call.args)) {
                    resolve(true);
                    return;
                  }
                  const t = tool(call.id);
                  if (t) t.status = "pending";
                  mark(true);
                  waiting.current.set(call.id, (allow, always) => {
                    const step = tool(call.id);
                    if (step) step.status = allow ? "running" : "denied";
                    mark(true);
                    if (allow && always) rememberRule(call.name, call.args);
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
                : "La réponse s'est interrompue. Vérifiez votre connexion.";
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
        const closed = (m: Message): Message => ({
          ...m,
          error,
          ...(usage ? { usage } : {}),
          steps: m.steps?.map((s) =>
            s.type === "tool" &&
            (s.status === "running" || s.status === "pending")
              ? { ...s, status: "failed", output: s.output ?? "[interrompu]" }
              : s,
          ),
        });
        /* Compactage : la ligne d'etat ne survit jamais au tour. Reussi, le
           resume remplace tout le fil — pour un agent par abonnement, sa
           session est fermee, la suivante repartira du resume au lieu de
           l'historique complet. Arrete, il ne reste rien. Echoue, l'erreur
           est dite a part, avec de quoi reessayer. */
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
            /* Le decompte du tour de compactage mesurait l'ANCIEN fil : la
               jauge repart de l'estimation du nouveau. */
            setLive({ rate: null, produced: 0 });
            if (opts.thenReplay) await turn(conversation.id, opts.thenReplay.text, opts.thenReplay.opts);
            return;
          }
          saveConversation({ ...finished, updatedAt: Date.now(), messages: finished.messages.slice(0, -1) });
          if (aborted) return;
          /* La demande de resume deborde elle-meme du contexte : une fois,
             en elaguant fort tous les resultats d'outils rejoues. */
          if (!acp && !opts.hardPrune && isContextOverflow(caught)) {
            await turn(conversation.id, text, { ...opts, hardPrune: true });
            return;
          }
          const why = error ?? "L'agent n'a pas produit de résumé.";
          setCompactError({
            conversationId: conversation.id,
            message: opts.compactedBy && opts.compactedBy !== "user" ? `${why} ${COMPACT_HINT}` : why,
          });
          return;
        }

        /* Le fournisseur a refuse le contexte : on compacte « dur », puis on
           rejoue. Un tour qui n'avait rien produit est retire et son message
           renvoye tel quel ; un tour qui avait deja travaille reste (le
           resume couvre l'« En cours ») et la tache reprend. */
        const worked = last.content.length > 0 || (last.steps?.length ?? 0) > 0;
        const overflow =
          !acp && !stopped && !opts.recovered && isContextOverflow(caught) && (worked || finished.messages.length > 2);
        if (overflow) {
          const replay: TurnOptions = worked
            ? { recovered: true }
            : { attachments: joints, research: opts.research, recovered: true };
          if (worked) error = "Fenêtre de contexte dépassée en cours de tâche : le fil est compacté, puis la tâche reprend.";
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
            thenReplay: { text: worked ? CONTINUE_PROMPT : content, opts: replay },
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

        /* Jauge pleine en fin de tour propre : on compacte pendant que
           l'utilisateur lit, plutot que de le faire attendre au prochain
           message. */
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

  /* Reprendre apres une erreur : le dernier echange (question, reponse en
     erreur) est retire du fil et la question est renvoyee telle quelle. */
  const retry = useCallback(() => {
    if (!conversationId || streamingId) return;
    const c = getConversation(conversationId);
    if (!c) return;
    const last = c.messages[c.messages.length - 1];
    const question = c.messages[c.messages.length - 2];
    if (!last?.error || question?.role !== "user") return;
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

/* La memoire de l'agent, relue a chaque tour (elle change pendant la
   conversation). Sans serveur, pas de memoire — jamais bloquant. */
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
  title: "Nouvelle conversation",
  modelId,
  createdAt: now,
  updatedAt: now,
  messages: [],
});
