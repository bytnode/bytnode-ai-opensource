"use client";

import { memo } from "react";
import type { Message as MessageT } from "@/lib/domain/types";
import { Markdown } from "./markdown";
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
    return (
      <article className="msg msg-user">
        <div className="msg-bubble">{message.content}</div>
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
