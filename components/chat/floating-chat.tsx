"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CORNERS, anchorCorner, avatarAt, clampAvatar, dockFrom, panelBox, resizeBy, type Corner, type Point, type Size, type Viewport } from "@/lib/layout/float-dock";
import { relative } from "@/lib/plugins/scheduler/timeline";
import { useNow } from "@/lib/state/clock";
import { updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { ChevronDown, Close, Expand, Plus } from "@/components/ui/icons";
import { useCompanion } from "./companion";
import { useMessages } from "@/lib/i18n/react";
import "./floating-chat.css";

/* ---------------------------------------------------------------------------
   The floating agent (user request, 2026-10-05): leaving the conversations
   for a plugin's tab no longer leaves the agent behind.

   On every plugin's tab — never on the conversations, where the thread is
   already open — a small companion: a rounded pentagon in the app's
   navy glass, with two eyes, alive, drawn on the GPU (`companion.ts`), no
   disc around it. The user drags it anywhere; let go, it sticks to the
   nearest edge of the window, and stays there (`agentchat:ui`,
   `lib/layout/float-dock.ts`) — any of the four. A click opens, beside it, a SMALL
   conversation — the last one used, the same thread and the same engine as
   the conversations' page (`chat-shell.tsx` renders both) —, just what is
   needed to keep talking to the agent while looking at a chart. Its head
   menu shows the agents as chips and, under them, the chosen agent's
   conversations and « New conversation » — clicking another agent keeps
   the menu open and only changes the list under it (user request); the
   head also opens it in full, or closes it; any of its four corners
   resizes it (the opposite one stays put). In the narrow composer, the
   model chip is its arrows alone (user request). It stays open from
   one plugin's tab to the next, and through a visit to the conversations'
   page — it is found as it was left, on the same conversation.

   Without opening it, the companion says three things: the agent is
   writing (blue eyes, a light sweeping across it), a permission
   waits (amber eyes, it hops), a reply ended while it was closed (a blue
   dot).

   Drawn in a portal on `body`: the chat page that renders it is hidden
   behind the plugins' tabs, and those are zoomed (`.pv-bare`) — the
   floating agent is in screen pixels, above them.
--------------------------------------------------------------------------- */

export type ListedConversation = { id: string; agentId: string; title: string; updatedAt: number };
export type AgentChoice = { id: string; name: string; profession: string };

type Props = {
  /** A plugin's tab is in front, the switch is on, an agent exists. */
  shown: boolean;
  /** The open conversation's title (or « New conversation ») and its agent. */
  title: string;
  agentName: string;
  activeId: string | null;
  /** Every agent, and the one that answers here. */
  agents: AgentChoice[];
  agentId: string | null;
  /** Every conversation, newest first. */
  conversations: ListedConversation[];
  busy: boolean;
  /** A permission waits for the user in the running reply. */
  waiting: boolean;
  thread: ReactNode;
  composer: ReactNode;
  /** The conversation opens: bring the one to show (the running one, else
      the last used). */
  onOpen: () => void;
  onPick: (id: string) => void;
  /** A new conversation with this agent. */
  onNewWith: (agentId: string) => void;
  /** Open it in full, on the conversations' page. */
  onExpand: () => void;
};

/* --- The window, and the top of the room under the tab bar ---------------- */

const NO_ROOM = "0x0x0";
let room = NO_ROOM;

function measure(): string {
  const body = document.querySelector(".shell-body");
  const top = body ? Math.round(body.getBoundingClientRect().top) : 0;
  return `${window.innerWidth}x${window.innerHeight}x${top}`;
}

function subscribeRoom(changed: () => void) {
  const on = () => {
    room = measure();
    changed();
  };
  room = measure();
  window.addEventListener("resize", on);
  return () => window.removeEventListener("resize", on);
}

function useViewport(): Viewport {
  const [width, height, top] = useSyncExternalStore(subscribeRoom, () => room, () => NO_ROOM).split("x").map(Number);
  return { width, height, top };
}

const noop = () => () => {};
/** The portal's target exists: on the client, after hydration. */
const useClient = () => useSyncExternalStore(noop, () => true, () => false);

/** Moved further than this, a press on the avatar is a drag, not a click. */
const DRAG_FROM = 5;

/** Carried by the avatar, the box follows the hand at once; but when it
    SWAPS — to the other side of the avatar, or from above it to under it,
    as the avatar crosses the middle of the screen — it glides from where
    it was to its new place instead of jumping (user request: smoother,
    yet never late on the hand). A FLIP on the `translate` property: the
    box is already at its new place, the animation only plays the offset
    away, while the following stays instant. Read from the DOM after each
    render (its style's left/top and `data-place`), so no ref is touched
    while rendering. */
function useSwapGlide(panel: React.RefObject<HTMLElement | null>) {
  const last = useRef<{ x: number; y: number; place: string } | null>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) {
      last.current = null;
      return;
    }
    const now = { x: el.offsetLeft, y: el.offsetTop, place: el.dataset.place ?? "" };
    const before = last.current;
    last.current = now;
    if (!before || before.place === now.place || el.dataset.carried === undefined) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ translate: `${before.x - now.x}px ${before.y - now.y}px` }, { translate: "0px 0px" }], {
      duration: 280,
      easing: "cubic-bezier(0.3, 0.68, 0.25, 1)",
    });
  });
}

export function FloatingChat(props: Props) {
  const client = useClient();
  return client ? createPortal(<Floating {...props} />, document.body) : null;
}

function Floating({ shown, title, agentName, activeId, agents, agentId, conversations, busy, waiting, thread, composer, onOpen, onPick, onNewWith, onExpand }: Props) {
  const m = useMessages();
  const prefs = useUiPrefs();
  const vp = useViewport();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dragAt, setDragAt] = useState<Point | null>(null);
  /* While a corner is held: the size it gives. */
  const [live, setLive] = useState<Size | null>(null);
  const [hover, setHover] = useState(false);
  /* The agent whose conversations the menu lists — the one that answers,
     until another chip is clicked. */
  const [viewed, setViewed] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const press = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean; at: Point } | null>(null);
  const swallowClick = useRef(false);
  const grip = useRef<{ corner: Corner; sx: number; sy: number; start: Size; last: Size | null } | null>(null);

  /* A reply that ends while the conversation is closed, on a plugin's
     tab, is waiting to be read. Seen once the conversation opens, or the
     conversations' page shows it. Adjusted while rendering, from the
     previous value — no effect, no extra pass. */
  const [unread, setUnread] = useState(false);
  const [wasBusy, setWasBusy] = useState(busy);
  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (!busy && shown && !open) setUnread(true);
  }
  if (unread && (open || !shown)) setUnread(false);
  /* Open, it STAYS open — from one plugin's tab to the next, and through a
     visit to the conversations' page, on the same conversation (user
     request): this component stays mounted, hidden there, and keeps its
     state. Only its menu closes on the way. */
  if (!shown && menu) setMenu(false);

  /* The canvas exists once the window is measured: it comes alive then. */
  useCompanion(canvas, { busy, waiting, unread, hover, dragging: dragAt !== null }, shown && vp.width > 0);

  /* The conversations' list closes as menus do. */
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => {
      if (menuRoot.current && !menuRoot.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [menu]);

  useSwapGlide(panel);

  if (!shown || vp.width === 0) return null;

  /* THE AVATAR IS THE ANCHOR: it stays where it rests (or where the hand
     drags it) and the box is laid against it, toward the screen's middle,
     the avatar at the box's outer corner (`panelBox`). */
  const at = dragAt ?? avatarAt(prefs.floatDock, vp);
  const size = live ?? prefs.floatSize;
  const box = panelBox(at, size, vp);
  const place = at;

  const toggle = () => {
    if (open) {
      setOpen(false);
      setMenu(false);
      return;
    }
    onOpen();
    setOpen(true);
  };

  /* --- Dragging the avatar ---------------------------------------------- */

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { dx: e.clientX - place.x, dy: e.clientY - place.y, sx: e.clientX, sy: e.clientY, moved: false, at: place };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_FROM) return;
    p.moved = true;
    p.at = clampAvatar({ x: e.clientX - p.dx, y: e.clientY - p.dy }, vp);
    setDragAt(p.at);
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p?.moved) return;
    swallowClick.current = true;
    /* Let go: it sticks to the nearest edge; its box, open or not, is laid
       against it again there. */
    updateUiPrefs({ floatDock: dockFrom(p.at, vp) });
    setDragAt(null);
  };

  /* --- Resizing the conversation by its corners ---------------------------- */

  /* The box stays held at the avatar's corner (no grip there); the three
     others resize it, each along the edges it is free on. */
  const gripDown = (corner: Corner) => (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    grip.current = { corner, sx: e.clientX, sy: e.clientY, start: { width: box.width, height: box.height }, last: null };
  };
  const gripMove = (e: PointerEvent<HTMLSpanElement>) => {
    const g = grip.current;
    if (!g) return;
    g.last = resizeBy(g.corner, g.start, box, e.clientX - g.sx, e.clientY - g.sy);
    setLive(g.last);
  };
  const gripUp = () => {
    const g = grip.current;
    grip.current = null;
    if (!g?.last) return;
    updateUiPrefs({ floatSize: g.last });
    setLive(null);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (menu) setMenu(false);
    else setOpen(false);
  };

  const shownAgent = viewed ?? agentId;
  const listed = conversations.filter((c) => c.agentId === shownAgent);


  return (
    <div className="fc">
      {open && (
        <section
          className={`fc-panel is-${box.above ? "above" : "below"} is-${box.side}${live || dragAt ? " is-moving" : ""}`}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          ref={panel}
          data-place={`${box.side}-${box.above ? "above" : "below"}`}
          data-carried={dragAt ? "" : undefined}
          role="dialog"
          aria-label={m.chat.floating.conversationWith(agentName)}
          onKeyDown={onKey}
        >
          <header className="fc-head">
            <div className="fc-pick" ref={menuRoot}>
              <button type="button" className="fc-title" onClick={() => {
                  setViewed(null);
                  setMenu(!menu);
                }}
                aria-expanded={menu} aria-haspopup="menu" title={m.chat.floating.switch}>
                <span className="fc-title-text">{title}</span>
                <span className="fc-title-sub">
                  {agentName}
                  <ChevronDown />
                </span>
              </button>
              {menu && (
                <div className="fc-menu" role="menu">
                  {agents.length > 1 && (
                    <>
                      <p className="fc-menu-label">{m.chat.agents}</p>
                      <div className="fc-agents">
                        {agents.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={a.id === shownAgent}
                            className={`fc-agent${a.id === shownAgent ? " is-on" : ""}`}
                            title={a.profession}
                            onClick={() => setViewed(a.id)}
                          >
                            {a.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="fc-menu-new"
                    onClick={() => {
                      setMenu(false);
                      if (shownAgent) onNewWith(shownAgent);
                    }}
                  >
                    <Plus />
                    {m.chat.newConversation}
                  </button>
                  {listed.length > 0 ? <p className="fc-menu-label">{m.chat.conversations}</p> : <p className="fc-menu-empty">{m.chat.floating.empty}</p>}
                  {listed.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      className={`fc-menu-row${c.id === activeId ? " is-on" : ""}`}
                      onClick={() => {
                        setMenu(false);
                        onPick(c.id);
                      }}
                    >
                      <b>{c.title}</b>
                      {now > 0 && <small>{relative(c.updatedAt, now)}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="fc-icon"
              onClick={() => {
                setOpen(false);
                setMenu(false);
                onExpand();
              }}
              aria-label={m.chat.floating.expand}
              title={m.chat.floating.expand}
            >
              <Expand />
            </button>
            <button
              type="button"
              className="fc-icon"
              onClick={() => setOpen(false)}
              aria-label={m.common.close}
              title={m.common.close}
            >
              <Close />
            </button>
          </header>
          <div className="fc-body">{thread}</div>
          <div className="fc-foot">{composer}</div>
          {CORNERS.filter((c) => c !== anchorCorner(box)).map((c) => (
            <span
              key={c}
              className={`fc-grip is-${c}`}
              onPointerDown={gripDown(c)}
              onPointerMove={gripMove}
              onPointerUp={gripUp}
              onPointerCancel={gripUp}
              aria-hidden
            />
          ))}
        </section>
      )}

      <button
        type="button"
        className={`fc-avatar${dragAt ? " is-dragging" : ""}${live ? " is-following" : ""}${busy ? " is-busy" : ""}${open ? " is-open" : ""}`}
        style={{ translate: `${place.x}px ${place.y}px` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onClick={() => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          toggle();
        }}
        aria-label={open ? m.chat.floating.closeConversationWith(agentName) : m.chat.floating.talkTo(agentName)}
        aria-expanded={open}
        title={waiting ? m.chat.floating.waiting(agentName) : busy ? m.chat.floating.writing(agentName) : m.chat.floating.talkTo(agentName)}
      >
        {/* Shown until the shader draws (and without WebGL 2). */}
        <svg className="fc-mark" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 4.5 7 9l5 3 5-3-5-4.5ZM7 9v6l5 4.5M17 9v6l-5 4.5M12 12v7.5" />
        </svg>
        <canvas ref={canvas} className="fc-canvas" aria-hidden />
        {waiting ? <span className="fc-badge is-waiting" /> : unread ? <span className="fc-badge is-unread" /> : null}
      </button>
    </div>
  );
}
