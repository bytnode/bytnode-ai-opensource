import type { JsonSchema, ToolResult } from "@/lib/tools/types";
import { validateArgs } from "@/lib/tools/validate";
import type { Delta } from "@/lib/llm/sse";
import type { AgentEvent } from "./events";
import type { ProviderMessage } from "./history";
import { ToolCallAccumulator, type ToolCall } from "./tool-calls";
import { MAX_ATTEMPTS, RepetitionGuard, backoffDelay, isTransient } from "./resilience";

/* ---------------------------------------------------------------------------
   La boucle de l'agent : modele → outils → modele, jusqu'a une reponse.

   Elle ne sait ni parler a OpenRouter ni executer un outil : on lui donne
   les deux. C'est ce qui lui permet de tourner dans le navigateur (l'agent
   principal : le modele via `/api/chat`, les outils via `/api/tools`, et
   l'utilisateur a qui demander la permission) comme sur le serveur (un
   sous-agent lance par Workflow : tout en direct, sans permission a
   demander). Une seule boucle, deux branchements.

   ⚠️ LA BOUCLE EST BORNEE. Un modele qui appelle un outil a chaque tour sans
   jamais conclure tournerait sans fin : au-dela de `maxTurns`, on lui
   retire les outils pour le dernier tour et on le laisse conclure.

   ⚠️ ELLE A UN FILET (voir `resilience.ts`). Une erreur transitoire — 429,
   502, connexion coupee — est relancee tant que RIEN n'a encore ete emis :
   un tour ne se perd pas pour une surcharge passagere. Et le meme appel
   d'outil, avec les memes arguments, trois fois de suite, n'est pas
   execute une quatrieme : l'agent recoit un refus qui lui dit de changer
   de voie.

   ⚠️ LES ARGUMENTS SONT VERIFIES AVANT TOUT (voir `tools/validate.ts`). Un
   appel mal forme n'est ni execute ni soumis a l'utilisateur : le modele
   recoit la raison et corrige au tour suivant.
--------------------------------------------------------------------------- */

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: unknown } };

export type LoopDeps = {
  /** Un tour de modele : rend les deltas du flux. */
  complete: (messages: ProviderMessage[], tools: ToolSpec[] | undefined, signal: AbortSignal) => AsyncIterable<Delta>;
  /** L'execution d'un outil. `emit` sert aux evenements en cours de route
      (lignes d'un Monitor, avancement d'un sous-agent). */
  execute: (call: ToolCall, signal: AbortSignal, emit: (e: AgentEvent) => void) => Promise<ToolResult>;
  /** Demande l'accord avant un outil sensible. Absent : tout est permis. */
  permission?: (call: ToolCall) => Promise<boolean>;
  gated?: (name: string) => boolean;
  emit: (e: AgentEvent) => void;
  tools: ToolSpec[];
  maxTurns?: number;
  signal: AbortSignal;
};

/** `finishReason` : celle du modele, ou `max_turns` si la boucle a coupe. */
export type LoopResult = { text: string; turns: number; finishReason: string };

const DEFAULT_MAX_TURNS = 40;

export async function runAgentLoop(messages: ProviderMessage[], deps: LoopDeps): Promise<LoopResult> {
  const history = messages.slice();
  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  const guard = new RepetitionGuard();
  let finalText = "";

  for (let turn = 1; ; turn++) {
    const last = turn >= maxTurns;
    const tools = last || deps.tools.length === 0 ? undefined : deps.tools;

    let text = "";
    let finish = "stop";
    const acc = new ToolCallAccumulator();
    /* Ce qui suit peut etre relance : on ne relance que si le flux n'a rien
       produit, sinon on dupliquerait du texte deja affiche. */
    for (let attempt = 0; ; attempt++) {
      let emitted = false;
      try {
        for await (const d of deps.complete(history, tools, deps.signal)) {
          if (d.error) throw new Error(d.error);
          if (d.usage || d.provider) {
            deps.emit({
              type: "usage",
              usage: { ...(d.usage ?? {}), ...(d.provider ? { provider: d.provider } : {}) },
            });
          }
          if (d.thought) {
            emitted = true;
            deps.emit({ type: "thought", text: d.thought });
          }
          if (d.text) {
            emitted = true;
            text += d.text;
            deps.emit({ type: "text", text: d.text });
          }
          if (d.toolCalls) {
            emitted = true;
            acc.add(d.toolCalls);
          }
          if (d.finish) finish = d.finish;
        }
        break;
      } catch (e) {
        if (deps.signal.aborted) throw e;
        if (emitted || attempt + 1 >= MAX_ATTEMPTS || !isTransient(e)) throw e;
        const attente = backoffDelay(attempt);
        deps.emit({
          type: "retry",
          attempt: attempt + 1,
          of: MAX_ATTEMPTS,
          delayMs: attente,
          reason: e instanceof Error ? e.message : String(e),
        });
        await new Promise((r) => setTimeout(r, attente));
        text = "";
        acc.reset();
      }
    }
    finalText += text;

    const calls = acc.calls().filter((c) => c.name);
    if (calls.length === 0) {
      deps.emit({ type: "done", finishReason: finish });
      return { text: finalText, turns: turn, finishReason: finish };
    }
    /* Le dernier tour n'avait plus d'outils : un modele qui en appelle
       quand meme n'aura pas un tour de plus. */
    if (last) {
      deps.emit({ type: "done", finishReason: "max_turns" });
      return { text: finalText, turns: turn, finishReason: "max_turns" };
    }

    history.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.rawArgs || "{}" } })),
    });

    /* Les outils s'executent l'un apres l'autre, dans l'ordre demande : un
       Edit qui suit un Read doit voir le fichier tel qu'il vient d'etre lu. */
    const images: Array<{ name: string; dataUrl: string }> = [];
    for (const call of calls) {
      if (deps.signal.aborted) throw new DOMException("Interrompu", "AbortError");
      deps.emit({ type: "tool_call", id: call.id, name: call.name, args: call.args });
      let result: ToolResult;
      const enBoucle = guard.check(call);
      const malForme = invalidArgs(deps.tools, call);
      if (enBoucle) {
        result = { ok: false, output: enBoucle };
      } else if (malForme) {
        result = { ok: false, output: malForme };
      } else if (deps.permission && deps.gated?.(call.name) && !(await deps.permission(call))) {
        result = { ok: false, output: "Refusé par l'utilisateur. N'insistez pas : proposez une autre approche ou demandez ce qu'il souhaite." };
      } else {
        try {
          result = await deps.execute(call, deps.signal, deps.emit);
        } catch (e) {
          result = { ok: false, output: `L'outil a échoué : ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      /* Ce que le fil affiche : un chemin dans le dossier de travail (servi
         par /api/files), sinon l'image elle-meme. */
      const shown = (result.attachments ?? [])
        .filter((a) => a.type === "image")
        .map((a) => ({ name: a.name, src: a.path && !a.name.includes(":") ? `file:${a.name}` : a.dataUrl }));
      if (result.ok) guard.succeeded(call);
      deps.emit({ type: "tool_result", id: call.id, ok: result.ok, output: result.output, ...(shown.length ? { images: shown } : {}) });
      history.push({ role: "tool", tool_call_id: call.id, content: result.output });
      for (const a of result.attachments ?? []) if (a.type === "image") images.push({ name: a.name, dataUrl: a.dataUrl });
    }

    /* Une image lue ne passe pas dans un resultat d'outil (texte seul) : on
       la montre au modele dans un message a part, juste apres. */
    if (images.length > 0) {
      history.push({
        role: "user",
        content: images.flatMap((im) => [
          { type: "text" as const, text: `Image lue par Read : ${im.name}` },
          { type: "image_url" as const, image_url: { url: im.dataUrl } },
        ]),
      });
    }
  }
}

/** La phrase a rendre au modele si l'appel ne respecte pas le schema de
    l'outil ; `null` sinon (ou si l'outil est inconnu : l'execution dira). */
function invalidArgs(tools: ToolSpec[], call: ToolCall): string | null {
  if (call.argsError) return `Arguments illisibles pour ${call.name} : ${call.argsError}. Renvoie l'appel avec un objet JSON valide.`;
  const spec = tools.find((t) => t.function.name === call.name)?.function.parameters;
  if (!isSchema(spec)) return null;
  const problem = validateArgs(spec, call.args);
  return problem ? `Arguments invalides pour ${call.name} : ${problem} Corrige l'appel.` : null;
}

const isSchema = (v: unknown): v is JsonSchema =>
  typeof v === "object" && v !== null && (v as { type?: unknown }).type === "object" && typeof (v as { properties?: unknown }).properties === "object";
