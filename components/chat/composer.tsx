"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { Attachment } from "@/lib/agent/attachments";
import { completeCommand, isCommandText, matchCommands, runCommand, type SlashCommand } from "@/lib/agent/commands";
import { ArrowUp, Camera, Check, Close, File as FileIcon, Plus, Search, Spinner, Stop } from "@/components/ui/icons";
import { ComposerPopover } from "./composer-popover";
import { ModelPicker } from "./model-picker";
import { useRimLight, type RimState } from "./rim-light";
import "./composer.css";

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
  /** The conversation has begun: one line under it, not the centred pane. */
  docked?: boolean;
};

/** The glass's corner radius, CSS px: `composer.css` (`.cmp`) and the rim's
    shader draw the same curve. */
const RADIUS = 26;

/* ---------------------------------------------------------------------------
   The composer: a pane of frosted glass on the backdrop's light.

   The glass is CSS (`composer.css`); its edge is a rim of light drawn by a
   shader (`rim-light.ts`) that wakes when the user writes and travels while
   the agent replies. Enter sends, Shift+Enter breaks the line; the field
   grows with the text up to a height where it scrolls. Centred (a new
   conversation), the field is on top and the controls under it; `docked`
   (the conversation has begun), everything is one line: the "+", the
   field, the conversation's settings (a chip: the model, its effort), the
   send button — the backdrop's navy, lit, when there is something to send;
   a square while the agent replies, which stops it.

   The two popovers (the "+", the settings) close as menus do: a press
   anywhere else, Escape — and typing or clicking in the field, since the
   user has moved on.

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
  docked = false,
}: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const rimCanvas = useRef<HTMLCanvasElement>(null);
  /* What will leave with the message: the attachments already dropped, and
     the deep research request. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [research, setResearch] = useState(false);
  /* The popover open, if any: one at a time. */
  const [pop, setPop] = useState<"plus" | "settings" | null>(null);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState<"fichiers" | "capture" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /* The command list: the chosen row, and the text for which it was closed
     (Escape) — it only reopens if the text changes. */
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const commands = disabled ? [] : matchCommands(text);
  const palette = commands.length > 0 && dismissed !== text;
  const index = Math.min(selected, Math.max(0, commands.length - 1));

  const rim: RimState = streaming ? "busy" : focused || text.length > 0 ? "focus" : "idle";
  useRimLight(rimCanvas, rim, RADIUS, docked);

  useEffect(() => {
    area.current?.focus();
  }, [focusKey]);

  const closePop = useCallback((refocus = false) => {
    setPop(null);
    if (refocus) area.current?.focus();
  }, []);

  /* Focus inside the composer — the field, a button, a popover — lights the
     rim; leaving it for the page puts it back to rest. */
  const onFocusIn = () => setFocused(true);
  const onFocusOut = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  const joindre = async (quoi: "fichiers" | "capture", run: () => Promise<Attachment[]>) => {
    setPop(null);
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
    <div className={`cmp${docked ? " is-docked" : ""}${focused ? " is-focused" : ""}${streaming ? " is-busy" : ""}`} onFocus={onFocusIn} onBlur={onFocusOut}>
      <canvas ref={rimCanvas} className="cmp-rim" aria-hidden />
      {(attachments.length > 0 || research || failure) && (
        <div className="cmp-joints">
          {research && (
            <span className="cmp-joint is-research">
              <Search />
              Deep research
              <button type="button" onClick={() => setResearch(false)} aria-label="Remove deep research">
                <Close />
              </button>
            </span>
          )}
          {attachments.map((a) => (
            <span key={a.path} className="cmp-joint" title={a.path}>
              {a.dataUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={a.dataUrl} alt="" className="cmp-joint-thumb" />
              ) : (
                <FileIcon />
              )}
              {a.name}
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))} aria-label={`Remove ${a.name}`}>
                <Close />
              </button>
            </span>
          ))}
          {failure && <span className="cmp-joint is-error">{failure}</span>}
        </div>
      )}
      <textarea
        ref={area}
        className="cmp-input"
        rows={1}
        placeholder={disabled ? "Connect an access to the models to write." : "Write your message…  (/ for commands)"}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setSelected(0);
          /* Typing means the user has moved on: an open popover goes. */
          setPop(null);
          grow();
        }}
        onPointerDown={() => setPop(null)}
        onKeyDown={onKey}
        aria-label="Your message"
        aria-autocomplete="list"
        aria-controls={palette ? "composer-commands" : undefined}
      />
      {palette && (
        <div className="cmp-commands" id="composer-commands" role="listbox" aria-label="Commands">
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
              <span className="cmp-command-name">
                /{c.name}
                {c.args && <span className="cmp-command-args"> {c.args}</span>}
              </span>
              <small>{c.description}</small>
            </button>
          ))}
          <p className="cmp-commands-hint">↑↓ to choose · Tab to complete · Enter to run · Esc to close</p>
        </div>
      )}
      <div className="cmp-bar">
        <div className="cmp-anchor">
          <button
            ref={plus}
            type="button"
            className={`cmp-plus${pop === "plus" ? " is-open" : ""}`}
            aria-label="Add"
            aria-haspopup="dialog"
            aria-expanded={pop === "plus"}
            title="Add files, a screenshot, deep research"
            disabled={disabled || busy !== null}
            onClick={() => setPop(pop === "plus" ? null : "plus")}
          >
            {busy ? <Spinner /> : <Plus />}
          </button>
          <ComposerPopover open={pop === "plus"} onClose={closePop} anchor={plus} align="start" width={328} label="Add to the message">
            <button type="button" data-item className="cmp-action" onClick={() => fileInput.current?.click()}>
              <span className="cmp-action-icon">
                <FileIcon />
              </span>
              <span className="cmp-action-text">
                <b>Add files</b>
                <small>Dropped into the agent&apos;s workspace</small>
              </span>
            </button>
            <button type="button" data-item className="cmp-action" onClick={() => void joindre("capture", onScreenshot)}>
              <span className="cmp-action-icon">
                <Camera />
              </span>
              <span className="cmp-action-text">
                <b>Take a screenshot</b>
                <small>You choose the screen or the window</small>
              </span>
            </button>
            <span className="cmp-sep" aria-hidden />
            <button
              type="button"
              data-item
              className={`cmp-action${research ? " is-on" : ""}`}
              aria-pressed={research}
              onClick={() => {
                setResearch(!research);
                closePop(true);
              }}
            >
              <span className="cmp-action-icon">
                <Search />
              </span>
              <span className="cmp-action-text">
                <b>Deep research</b>
                <small>{research ? "On for the next message" : "Several sources, cross-checked and dated"}</small>
              </span>
              <span className="cmp-item-check">{research && <Check />}</span>
            </button>
          </ComposerPopover>
        </div>
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
        <span className="cmp-spacer" />
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
          open={pop === "settings"}
          onOpenChange={(open, refocus) => (open ? setPop("settings") : closePop(refocus))}
        />
        {streaming ? (
          <button type="button" className="cmp-round cmp-send is-stop" onClick={onStop} aria-label="Stop the reply" title="Stop the reply">
            <Stop />
          </button>
        ) : (
          <button type="button" className={`cmp-round cmp-send${canSend ? " is-ready" : ""}`} onClick={submit} disabled={!canSend} aria-label="Send" title="Send (Enter)">
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  );
}
