"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { Attachment } from "@/lib/agent/attachments";
import { COMMANDS, commandOf, completeCommand, groupBySource, matchCommands, runCommand, type SlashCommand } from "@/lib/agent/commands";
import { ArrowRight, ArrowUp, Camera, Check, Close, File as FileIcon, Plus, Search, Spinner, Stop } from "@/components/ui/icons";
import { ComposerPopover } from "./composer-popover";
import { ModelPicker } from "./model-picker";
import { useRimLight, type RimState } from "./rim-light";
import { useMessages } from "@/lib/i18n/react";
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
  /** No access to the models: the field gives way to one quiet line saying
      why, with the way out — instead of a banner over the page (the user's
      request, 2026-10-05). */
  locked?: { message: string; action: string; onAction: () => void } | null;
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
  /** The commands offered on `/`: BytNode-AI's, and a subscription agent's
      own (`mergeCommands`). */
  commands?: readonly SlashCommand[];
  /** The command list opened or closed: it takes room in the page (the
      composer grows upward), the shell keeps the field where it was. */
  onPalette?: (open: boolean) => void;
  /** The field's invitation, when the place calls for its own (an
      agent's page). */
  placeholder?: string;
};

/** The glass's corner radius, CSS px: `composer.css` (`.cmp`) and the rim's
    shader draw the same curve. */
const RADIUS = 26;
/** The docked field's height on one line (36 px, see `.cmp.is-docked >
    .cmp-input`), with a margin: above it, the message wraps. */
const ONE_LINE = 44;
/** The field's tallest, CSS px (`.cmp-input` max-height): past it, it
    scrolls. */
const MAX_FIELD = 220;

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
   closes it: the command is complete. A subscription agent's own commands
   are in the list too, grouped under the agent that runs them.

   ⚠️ THE LIST IS PART OF THE GLASS, NOT A POPOVER OVER THE THREAD. It opens
   inside the pane, above the field: the composer grows upward and the
   thread (or the greeting) moves up to make room — nothing is covered.
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
  locked,
  onSend,
  onStop,
  onAttachFiles,
  onScreenshot,
  focusKey,
  docked = false,
  commands: offered = COMMANDS,
  onPalette,
  placeholder,
}: Props) {
  const m = useMessages();
  /* BytNode-AI's own commands speak the interface's language; an agent's
     own keep the words it published. */
  const own = (c: SlashCommand) =>
    c.source === undefined && COMMANDS.some((x) => x.name === c.name) ? (m.chat.composer.own as Partial<Record<string, { args: string; description: string }>>)[c.name] : undefined;
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
  /* Docked, a message longer than one line takes the capsule's whole width,
     the buttons on a row under it — instead of a narrow column between
     them with empty room above them (the user's request, 2026-09-29).
     Back to one line only once the field is empty: switching on every
     keystroke would make the text jump between the two widths. */
  const [tall, setTall] = useState(false);
  /* The command list: the chosen row, and the text for which it was closed
     (Escape) — it only reopens if the text changes. */
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  /* Shown grouped by who runs them; the keyboard walks the shown order. */
  const { groups, flat: commands } = groupBySource(disabled ? [] : matchCommands(text, offered));
  const list = useRef<HTMLDivElement>(null);
  const palette = commands.length > 0 && dismissed !== text;
  const index = Math.min(selected, Math.max(0, commands.length - 1));

  /* The shell keeps the field in place while the list takes its room. */
  useEffect(() => {
    onPalette?.(palette);
  }, [palette, onPalette]);

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

  /* The field's height follows its text, up to MAX_FIELD. ⚠️ It scrolls
     only past that cap: an `overflow: auto` field a pixel short of its
     text (a layout that changed after the measure) showed Windows'
     scrollbar arrows in a one-line field (user report). */
  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD)}px`;
    el.style.overflowY = el.scrollHeight > MAX_FIELD ? "auto" : "hidden";
  };

  const grow = () => {
    const el = area.current;
    if (!el) return;
    fit(el);
    /* Tall once it wraps, until it is emptied (no flip-flop on the edge). */
    const next = el.value ? tall || el.scrollHeight > ONE_LINE : false;
    if (next !== tall) {
      setTall(next);
      /* Its width changes with the layout — wider when tall, narrower when
         back on one line: measured again once laid out. */
      requestAnimationFrame(() => {
        if (area.current) fit(area.current);
      });
    }
  };

  /* A command (`/compact`, `/usage`) leaves alone: the attachments and the
     deep research stay in the field for the next message. A `$skill` is
     read inside an ordinary message: it takes them. */
  const submitText = (value: string) => {
    if ((!value.trim() && attachments.length === 0) || disabled || streaming || !modelId) return;
    const hit = commandOf(value, offered);
    const command = hit !== null && (hit.command.trigger ?? "/") === "/";
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
    /* Safari fires the Enter that confirms a Chinese / Japanese / Korean
       composition AFTER `compositionend`, `isComposing` false, keyCode 229:
       a half-typed message was sent. */
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (palette) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        const next = (index + d + commands.length) % commands.length;
        setSelected(next);
        /* A long list (Claude Code publishes some fifty) scrolls with the
           choice. */
        list.current?.querySelectorAll<HTMLElement>("[role=option]")[next]?.scrollIntoView({ block: "nearest" });
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
    <div
      className={`cmp${docked ? " is-docked" : ""}${docked && tall ? " is-tall" : ""}${focused ? " is-focused" : ""}${streaming ? " is-busy" : ""}`}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
      /* Files dropped on the composer are attached, like the `+` menu's. */
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files;
        if (!f.length) return;
        e.preventDefault();
        void joindre("fichiers", () => onAttachFiles(f));
      }}
    >
      <canvas ref={rimCanvas} className="cmp-rim" aria-hidden />
      {palette && (
        <div className="cmp-commands" id="composer-commands" role="listbox" aria-label={m.chat.composer.commands} ref={list}>
          <div className="cmp-commands-head">
            <span>{m.chat.composer.commands}</span>
            <span className="cmp-commands-keys" aria-hidden>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                {m.chat.composer.keyChoose}
              </span>
              <span>
                <kbd>Tab</kbd>
                {m.chat.composer.keyComplete}
              </span>
              <span>
                <kbd>↵</kbd>
                {m.chat.composer.keyRun}
              </span>
              <span>
                <kbd>esc</kbd>
                {m.chat.composer.keyClose}
              </span>
            </span>
          </div>
          <div className="cmp-commands-list">
            {groups.map((g) => (
              <div key={g.source} role="group" aria-label={g.source} className="cmp-commands-group">
                <p className="cmp-caption">{g.source}</p>
                {g.items.map((c) => {
                  const i = commands.indexOf(c);
                  const description = own(c)?.description ?? c.description;
                  const args = c.args && (own(c)?.args ?? c.args);
                  return (
                    <button
                      key={`${c.trigger ?? "/"}${c.name}`}
                      type="button"
                      role="option"
                      aria-selected={i === index}
                      className={`cmp-command${i === index ? " is-selected" : ""}`}
                      /* The click must not take focus away from the field. */
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => run(c)}
                      title={description || undefined}
                    >
                      <span className="cmp-command-glyph" aria-hidden>
                        {c.trigger ?? "/"}
                      </span>
                      <span className="cmp-item-text">
                        <b>
                          {c.name}
                          {args && <span className="cmp-command-args">{args}</span>}
                        </b>
                        {description && <small>{description}</small>}
                      </span>
                      {i === index && (
                        <kbd className="cmp-command-enter" aria-hidden>
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {(attachments.length > 0 || research || failure) && (
        <div className="cmp-joints">
          {research && (
            <span className="cmp-joint is-research">
              <Search />
              {m.chat.deepResearch}
              <button type="button" onClick={() => setResearch(false)} aria-label={m.chat.composer.removeResearch}>
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
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))} aria-label={m.chat.composer.remove(a.name)}>
                <Close />
              </button>
            </span>
          ))}
          {failure && <span className="cmp-joint is-error">{failure}</span>}
        </div>
      )}
      {locked ? (
        <div className="cmp-input cmp-locked">
          <span>{locked.message}</span>
          <button type="button" className="cmp-locked-action" onClick={locked.onAction}>
            {locked.action}
            <ArrowRight />
          </button>
        </div>
      ) : (
        <textarea
          ref={area}
          className="cmp-input"
          rows={1}
          placeholder={disabled ? m.chat.composer.placeholderLocked : (placeholder ?? m.chat.composer.placeholder)}
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
          aria-label={m.chat.composer.yourMessage}
          aria-autocomplete="list"
          aria-controls={palette ? "composer-commands" : undefined}
        />
      )}
      <div className="cmp-bar">
        <div className="cmp-anchor">
          <button
            ref={plus}
            type="button"
            className={`cmp-plus${pop === "plus" ? " is-open" : ""}`}
            aria-label={m.common.add}
            aria-haspopup="dialog"
            aria-expanded={pop === "plus"}
            title={m.chat.composer.addTitle}
            disabled={disabled || busy !== null}
            onClick={() => setPop(pop === "plus" ? null : "plus")}
          >
            {busy ? <Spinner /> : <Plus />}
          </button>
          <ComposerPopover open={pop === "plus"} onClose={closePop} anchor={plus} align="start" width={328} label={m.chat.composer.addToMessage}>
            <button type="button" data-item className="cmp-action" onClick={() => fileInput.current?.click()}>
              <span className="cmp-action-icon">
                <FileIcon />
              </span>
              <span className="cmp-action-text">
                <b>{m.chat.composer.addFiles}</b>
                <small>{m.chat.composer.addFilesHint}</small>
              </span>
            </button>
            <button type="button" data-item className="cmp-action" onClick={() => void joindre("capture", onScreenshot)}>
              <span className="cmp-action-icon">
                <Camera />
              </span>
              <span className="cmp-action-text">
                <b>{m.chat.composer.screenshot}</b>
                <small>{m.chat.composer.screenshotHint}</small>
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
                <b>{m.chat.deepResearch}</b>
                <small>{research ? m.chat.composer.researchOn : m.chat.composer.researchHint}</small>
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
          <button type="button" className="cmp-round cmp-send is-stop" onClick={onStop} aria-label={m.chat.composer.stopReply} title={m.chat.composer.stopReply}>
            <Stop />
          </button>
        ) : (
          <button type="button" className={`cmp-round cmp-send${canSend ? " is-ready" : ""}`} onClick={submit} disabled={!canSend} aria-label={m.chat.composer.send} title={m.chat.composer.sendTitle}>
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  );
}
