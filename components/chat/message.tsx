"use client";

import { memo, useState } from "react";
import type { Message as MessageT } from "@/lib/domain/types";
import type { PlanEntry } from "@/lib/agent/events";
import { COMPACT_LABEL } from "@/lib/agent/compact";
import { Markdown } from "./markdown";
import { ChevronDown } from "@/components/ui/icons";
import { ToolStepView } from "./tool-step";

type Props = {
  message: MessageT;
  streaming: boolean;
  onRetry?: () => void;
  onAnswer?: (callId: string, allow: boolean, always?: boolean) => void;
  /** L'adresse d'un fichier du dossier de travail (images des outils). */
  fileUrl?: (rel: string) => string;
};

/* ---------------------------------------------------------------------------
   Un message du fil.

   Le vôtre est un bloc de matiere cale a droite : c'est vous qui parlez, la
   forme le dit. Celui de l'agent n'a pas de bulle — il est ecrit a meme la
   page, comme une reponse et non comme un post-it. Sous lui, en mono et en
   encre attenuee, le modele qui l'a produit : c'est une information, pas une
   decoration, et on la cherche des qu'une reponse surprend.
--------------------------------------------------------------------------- */
export const Message = memo(function Message({ message, streaming, onRetry, onAnswer, fileUrl }: Props) {
  if (message.role === "user") {
    const joints = message.attachments ?? [];
    return (
      <article className="msg msg-user">
        {joints.length > 0 && (
          <div className="msg-joints">
            {joints.map((a) => (
              <span key={a.path} className="msg-joint" title={a.path}>
                {a.dataUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={a.dataUrl} alt={a.name} />
                ) : (
                  <span className="msg-joint-name mono">{a.name}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="msg-bubble">
          {message.research && <span className="msg-research">Recherche approfondie</span>}
          {message.content}
        </div>
      </article>
    );
  }

  if (message.compaction) {
    return (
      <article className="msg msg-compact">
        <p className="msg-compact-head">{COMPACT_LABEL}</p>
        <div className="md">
          <Markdown text={message.content} />
        </div>
      </article>
    );
  }

  const steps = message.steps ?? [];
  const empty = message.content.length === 0 && steps.length === 0;
  const lastIsText = steps.length > 0 && steps[steps.length - 1].type === "text";
  return (
    <article className={`msg msg-agent${streaming && (steps.length === 0 || lastIsText) ? " is-streaming" : ""}`}>
      {empty && streaming ? (
        <div className="msg-wait" aria-label="L'agent rédige">
          <span />
          <span />
          <span />
        </div>
      ) : steps.length > 0 ? (
        steps.map((s, i) =>
          s.type === "text" ? (
            <div className="md" key={i}>
              <Markdown text={s.text} />
            </div>
          ) : s.type === "thought" ? (
            <ThoughtView key={i} text={s.text} />
          ) : s.type === "plan" ? (
            <PlanView key={i} entries={s.entries} />
          ) : (
            <ToolStepView key={s.id} step={s} fileUrl={fileUrl} onAnswer={onAnswer ? (allow, always) => onAnswer(s.id, allow, always) : undefined} />
          ),
        )
      ) : (
        <div className="md">
          <Markdown text={message.content} />
        </div>
      )}
      {streaming && steps.length > 0 && !lastIsText && (
        <div className="msg-wait msg-wait-tools" aria-label="L'agent travaille">
          <span />
          <span />
          <span />
        </div>
      )}
      {message.error && (
        <div className="notice msg-error" role="alert">
          <p>{message.error}</p>
          {onRetry && (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              Réessayer
            </button>
          )}
        </div>
      )}
      {message.modelId && !empty && (
        <p className="msg-model mono">
          {message.modelId}
          {message.effort ? ` · ${message.effort}` : ""}
        </p>
      )}
    </article>
  );
});

/* ---------------------------------------------------------------------------
   Le plan que l'agent s'est donne, et son raisonnement.

   Les deux arrivent dans le flux (les agents par abonnement les publient,
   les modeles a effort exposent leurs jetons de reflexion) et n'etaient pas
   montres. Le plan se lit d'un coup d'oeil ; la reflexion est repliee — on
   l'ouvre quand une reponse surprend.
--------------------------------------------------------------------------- */

const PlanView = memo(function PlanView({ entries }: { entries: PlanEntry[] }) {
  const faits = entries.filter((e) => e.status === "completed").length;
  return (
    <div className="plan">
      <p className="plan-head">
        Plan <span className="plan-count">{faits}/{entries.length}</span>
      </p>
      <ul>
        {entries.map((e, i) => (
          <li key={i} className={`plan-${e.status}`}>
            <span className="plan-mark" aria-hidden="true">
              {e.status === "completed" ? "✓" : e.status === "in_progress" ? "▸" : "·"}
            </span>
            {e.content}
          </li>
        ))}
      </ul>
    </div>
  );
});

const ThoughtView = memo(function ThoughtView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lignes = text.trim().split("\n").filter(Boolean);
  return (
    <div className={`thought${open ? " is-open" : ""}`}>
      <button type="button" className="thought-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown className="thought-chevron" />
        Réflexion
        <span className="thought-size">{lignes.length} ligne{lignes.length > 1 ? "s" : ""}</span>
      </button>
      {open && <div className="thought-body">{text.trim()}</div>}
    </div>
  );
});
