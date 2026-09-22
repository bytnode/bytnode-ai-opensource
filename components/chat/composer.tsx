"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Attachment } from "@/lib/agent/attachments";
import { completeCommand, isCommandText, matchCommands, runCommand, type SlashCommand } from "@/lib/agent/commands";
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
  /** Drop files into the agent's workspace. */
  onAttachFiles: (files: FileList | File[]) => Promise<Attachment[]>;
  /** Capture a screen or a window, through the browser. */
  onScreenshot: () => Promise<Attachment[]>;
  /** Changes on every new conversation: the field takes focus again. */
  focusKey: string;
};

/* ---------------------------------------------------------------------------
   The composer: the only rectangle of solid material on the page.

   Enter sends, Shift+Enter breaks the line. The area grows with the text up
   to a height where it scrolls. At the bottom: on the left the "+"; on the
   right the model and the effort in bare text, then the button — an arrow
   that becomes a square while the agent replies, and stops the reply.

   COMMANDS ARE DISCOVERED BY TYPING `/`. From the first character, the list
   of those that match opens above the field, with a word of explanation
   (`lib/agent/commands.ts`): ↑↓ to choose, Tab to complete (and add
   instructions), Enter to run, Escape to close. A space after the name
   closes it: the command is complete.
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
  /* What will leave with the message: the attachments already dropped, and
     the deep research request. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [research, setResearch] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<"fichiers" | "capture" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /* The command list: the chosen row, and the text for which it was closed
     (Escape) — it only reopens if the text changes. */
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const commands = disabled ? [] : matchCommands(text);
  const palette = commands.length > 0 && dismissed !== text;
  const index = Math.min(selected, Math.max(0, commands.length - 1));

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
      /* A closed dialog is not an error: empty message. */
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

  /* A command (`/compact`) leaves alone: the attachments and the deep
     research stay in the field for the next message. */
  const submitText = (value: string) => {
    if ((!value.trim() && attachments.length === 0) || disabled || streaming || !modelId) return;
    const command = isCommandText(value);
    onSend(value, command ? { attachments: [], research: false } : { attachments, research });
    setText("");
    if (!command) {
      setAttachments([]);
      setResearch(false);
    }
    requestAnimationFrame(grow);
  };
  const submit = () => submitText(text);

  /* Complete a command: its name and a space, to type what follows. */
  const complete = (c: SlashCommand) => {
    setText(completeCommand(c));
    setSelected(0);
    requestAnimationFrame(grow);
    area.current?.focus();
  };
  /* Run it from the list: the command alone, right away. */
  const run = (c: SlashCommand) => submitText(runCommand(c));

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (palette) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSelected((index + d + commands.length) % commands.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        complete(commands[index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(text);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        run(commands[index]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
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
              Deep research
              <button type="button" onClick={() => setResearch(false)} aria-label="Remove deep research">
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
                aria-label={`Remove ${a.name}`}
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
        placeholder={disabled ? "Connect an access to the models to write." : "Write your message…  (/ for commands)"}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setSelected(0);
          grow();
        }}
        onKeyDown={onKey}
        aria-label="Your message"
        aria-autocomplete="list"
        aria-controls={palette ? "composer-commands" : undefined}
      />
      {palette && (
        <div className="composer-commands" id="composer-commands" role="listbox" aria-label="Commands">
          {commands.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === index}
              className={i === index ? "is-selected" : ""}
              /* The click must not take focus away from the field. */
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(c)}
            >
              <span className="composer-command-name mono">
                /{c.name}
                {c.args && <span className="composer-command-args"> {c.args}</span>}
              </span>
              <small>{c.description}</small>
            </button>
          ))}
          <p className="composer-commands-hint">↑↓ choose · Tab complete · Enter run · Esc close</p>
        </div>
      )}
      <div className="composer-bar">
        <button
          type="button"
          className={`composer-plus${menu ? " is-open" : ""}`}
          aria-label="Add"
          aria-haspopup="menu"
          aria-expanded={menu}
          title="Add"
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
                Add files
                <small>dropped into the agent&apos;s workspace</small>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => void joindre("capture", onScreenshot)}>
              <Camera />
              <span>
                Take a screenshot
                <small>you choose the screen or the window</small>
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
                Deep research
                <small>{research ? "on for the next message" : "several sources, cross-checked and dated"}</small>
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
          <button type="button" className="composer-send is-stop" onClick={onStop} aria-label="Stop the reply">
            <Stop />
          </button>
        ) : (
          <button type="button" className="composer-send" onClick={submit} disabled={!canSend} aria-label="Send">
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  );
}
