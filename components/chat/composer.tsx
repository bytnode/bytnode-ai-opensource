"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Attachment } from "@/lib/agent/attachments";
import { ArrowUp, Camera, Close, File as FileIcon, Plus, Search, Spinner, Stop } from "@/components/ui/icons";
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
  onSend: (text: string, opts: { attachments: Attachment[]; research: boolean }) => void;
  onStop: () => void;
  /** Déposer des fichiers dans le dossier de travail de l'agent. */
  onAttachFiles: (files: FileList | File[]) => Promise<Attachment[]>;
  /** Capturer un écran ou une fenêtre, par le navigateur. */
  onScreenshot: () => Promise<Attachment[]>;
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
  onAttachFiles,
  onScreenshot,
  focusKey,
}: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /* Ce qui partira avec le message : les pieces jointes deja deposees, et
     la demande de recherche approfondie. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [research, setResearch] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<"fichiers" | "capture" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    area.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setMenu(false);
    };
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  const joindre = async (quoi: "fichiers" | "capture", run: () => Promise<Attachment[]>) => {
    setMenu(false);
    setBusy(quoi);
    setFailure(null);
    try {
      const ajout = await run();
      if (ajout.length) setAttachments((prev) => [...prev, ...ajout]);
    } catch (e) {
      /* Un dialogue ferme n'est pas une erreur : message vide. */
      const m = e instanceof Error ? e.message : String(e);
      if (m) setFailure(m);
    } finally {
      setBusy(null);
      area.current?.focus();
    }
  };

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const submit = () => {
    if ((!text.trim() && attachments.length === 0) || disabled || streaming || !modelId) return;
    onSend(text, { attachments, research });
    setText("");
    setAttachments([]);
    setResearch(false);
    requestAnimationFrame(grow);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !!modelId;

  return (
    <div className="composer" ref={root}>
      {(attachments.length > 0 || research || failure) && (
        <div className="composer-joints">
          {research && (
            <span className="joint joint-research">
              <Search />
              Recherche approfondie
              <button type="button" onClick={() => setResearch(false)} aria-label="Retirer la recherche approfondie">
                <Close />
              </button>
            </span>
          )}
          {attachments.map((a) => (
            <span key={a.path} className="joint" title={a.path}>
              {a.dataUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={a.dataUrl} alt="" className="joint-vignette" />
              ) : (
                <FileIcon />
              )}
              {a.name}
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                aria-label={`Retirer ${a.name}`}
              >
                <Close />
              </button>
            </span>
          ))}
          {failure && <span className="joint joint-error">{failure}</span>}
        </div>
      )}
      <textarea
        ref={area}
        className="composer-input"
        rows={1}
        placeholder={disabled ? "Connectez un accès aux modèles pour écrire." : "Écrivez votre message…  (/compact pour résumer le fil)"}
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
        <button
          type="button"
          className={`composer-plus${menu ? " is-open" : ""}`}
          aria-label="Ajouter"
          aria-haspopup="menu"
          aria-expanded={menu}
          title="Ajouter"
          disabled={disabled || busy !== null}
          onClick={() => setMenu(!menu)}
        >
          {busy ? <Spinner /> : <Plus />}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const f = e.target.files;
            if (f && f.length) void joindre("fichiers", () => onAttachFiles(f));
            e.target.value = "";
          }}
        />
        {menu && (
          <div className="composer-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}>
              <FileIcon />
              <span>
                Ajouter des fichiers
                <small>déposés dans le dossier de travail de l&apos;agent</small>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => void joindre("capture", onScreenshot)}>
              <Camera />
              <span>
                Prendre une capture d&apos;écran
                <small>vous choisissez l&apos;écran ou la fenêtre</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={research ? "is-on" : ""}
              onClick={() => {
                setResearch(!research);
                setMenu(false);
              }}
            >
              <Search />
              <span>
                Recherche approfondie
                <small>{research ? "active pour le prochain message" : "plusieurs sources, recoupées et datées"}</small>
              </span>
            </button>
          </div>
        )}
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
