"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Plus, Stop } from "@/components/ui/icons";
import { ModelPicker } from "./model-picker";

type Props = {
  providerId: string;
  modelId: string | null;
  effort: string | null;
  onModel: (id: string) => void;
  onEffort: (effort: string | null) => void;
  mode: string | null;
  modeOptions: Array<{ value: string; name: string; description?: string | null }>;
  onMode: (mode: string) => void;
  profession: string;
  professionOptions: Array<{ value: string; name: string; description?: string | null }>;
  onProfession: (profession: string) => void;
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Change a chaque nouvelle conversation : le champ reprend le focus. */
  focusKey: string;
};

/* ---------------------------------------------------------------------------
   Le bloc de saisie : le seul rectangle de matiere pleine de la page.

   Entree envoie, Maj+Entree passe a la ligne. La zone grandit avec le texte
   jusqu'a une hauteur ou elle defile. En bas : a gauche le « + » ; a droite
   le modele et l'effort en texte nu, puis le bouton — une fleche qui devient
   un carre pendant que l'agent repond, et arrete la reponse.
--------------------------------------------------------------------------- */
export function Composer({
  providerId,
  modelId,
  effort,
  onModel,
  onEffort,
  mode,
  modeOptions,
  onMode,
  profession,
  professionOptions,
  onProfession,
  streaming,
  disabled,
  onSend,
  onStop,
  focusKey,
}: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, [focusKey]);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const submit = () => {
    if (!text.trim() || disabled || streaming || !modelId) return;
    onSend(text);
    setText("");
    requestAnimationFrame(grow);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = text.trim().length > 0 && !disabled && !!modelId;

  return (
    <div className="composer">
      <textarea
        ref={area}
        className="composer-input"
        rows={1}
        placeholder={disabled ? "Connectez un accès aux modèles pour écrire." : "Écrivez votre message…"}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          grow();
        }}
        onKeyDown={onKey}
        aria-label="Votre message"
      />
      <div className="composer-bar">
        <button type="button" className="composer-plus" aria-label="Ajouter" title="Ajouter" disabled={disabled}>
          <Plus />
        </button>
        <span className="composer-spacer" />
        <ModelPicker
          providerId={providerId}
          modelId={modelId}
          effort={effort}
          onModel={onModel}
          onEffort={onEffort}
          mode={mode}
          modeOptions={modeOptions}
          onMode={onMode}
          profession={profession}
          professionOptions={professionOptions}
          onProfession={onProfession}
          disabled={disabled}
          quiet
        />
        {streaming ? (
          <button type="button" className="composer-send is-stop" onClick={onStop} aria-label="Arrêter la réponse">
            <Stop />
          </button>
        ) : (
          <button type="button" className="composer-send" onClick={submit} disabled={!canSend} aria-label="Envoyer">
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  );
}
