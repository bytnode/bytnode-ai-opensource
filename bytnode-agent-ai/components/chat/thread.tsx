"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { ArrowDown } from "@/components/ui/icons";
import { Message } from "./message";

type Props = {
  settings: Settings;
  agent: AgentConfig;
  conversation: Conversation | null;
  streaming: boolean;
  onRetry: () => void;
  onAnswer: (callId: string, allow: boolean, always?: boolean) => void;
};

/* ---------------------------------------------------------------------------
   Le fil.

   Vide, il salue : le prenom en grand, en Geist legere. Plein, il SUIT ce
   qui arrive — texte, appels d'outils, lignes d'un Monitor — tant que le
   lecteur est en bas. Des qu'il remonte lire, on le laisse : plus aucun
   defilement automatique jusqu'a ce qu'il revienne en bas de lui-meme, ou
   par le bouton qui apparait alors.

   ⚠️ LE SUIVI OBSERVE LA HAUTEUR DU CONTENU, PAS LE TEXTE. Un appel d'outil
   qui s'affiche, une ligne de Monitor, un bloc qui se deplie changent la
   hauteur sans changer le texte : c'est `ResizeObserver` qui les voit tous.

   ⚠️ UN DEFILEMENT PROGRAMME NE DOIT PAS PASSER POUR UN GESTE. Poser
   `scrollTop` declenche `scroll` comme un coup de molette ; on le marque
   pour que la position du lecteur ne soit relue que sur SES gestes.
--------------------------------------------------------------------------- */
export function Thread({ settings, agent, conversation, streaming, onRetry, onAnswer }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const programmatic = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      programmatic.current = false;
    });
  };

  const onScroll = () => {
    if (programmatic.current) return;
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinned.current = atBottom;
    setShowJump(!atBottom);
  };

  /* Nouveau fil : on repart du bas, epingle. Le composant est remonte par
     conversation (cle posee par le parent), donc l'etat repart de zero. */
  useLayoutEffect(() => {
    pinned.current = true;
    toBottom();
  }, []);

  /* Tout ce qui change la hauteur du contenu fait suivre le lecteur epingle. */
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!conversation || conversation.messages.length === 0) {
    const who = settings.profile.firstName.trim();
    const name = agent.name.trim() || "Votre agent";
    return (
      <div className="thread thread-empty">
        <h1 className="hello">{who ? `Bonjour, ${who}.` : "Bonjour."}</h1>
        <p className="hello-sub">{name} vous écoute.</p>
      </div>
    );
  }

  const last = conversation.messages.length - 1;
  /* Les images produites dans le dossier de travail sont servies par le
     serveur, pour cet agent. */
  const fileUrl = (rel: string) =>
    `/api/files?agentId=${encodeURIComponent(agent.id)}&workspace=${encodeURIComponent(agent.workspace ?? "")}&path=${encodeURIComponent(rel)}`;

  return (
    <div className="thread-wrap">
      <div className="thread" ref={scroller} onScroll={onScroll}>
        <div className="thread-inner" ref={inner}>
          {conversation.messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              fileUrl={fileUrl}
              streaming={streaming && i === last}
              onRetry={i === last && m.error ? onRetry : undefined}
              onAnswer={i === last ? onAnswer : undefined}
            />
          ))}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="thread-jump"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            toBottom();
          }}
          aria-label="Aller en bas"
        >
          <ArrowDown />
          {streaming ? "Suivre la réponse" : "Aller en bas"}
        </button>
      )}
    </div>
  );
}
