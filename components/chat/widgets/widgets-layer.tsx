"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import type { Settings } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
import { PLUGIN_MANIFESTS } from "@/lib/plugins/catalog";
import { enabledPlugins } from "@/lib/plugins/core/state";
import { openView } from "@/lib/state/tabs";
import { updateWidgets, useWidgets } from "@/lib/state/widgets";
import { SIZES, SIZE_PX, WIDGETS, addWidget, fitWidgets, hideWidget, insidePage, logicalArea, moveWidgetTo, removeWidget, resizeWidget, roomFor, showHidden, widgetInfo, widgetOn, widgetScale, type Area, type Page, type PlacedWidget, type Span, type Position, type WidgetInfo, type WidgetSize } from "@/lib/widgets/catalog";
import { useMessages } from "@/lib/i18n/react";
import { TabIcon } from "@/components/shell/tab-icons";
import { ViewActive } from "@/components/plugins/view-activity";
import { Check, Close, Pencil, Plus, Trash, Widgets as WidgetsIcon, Eye, EyeOff } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/use-dismiss";
import { WidgetBody } from "./widget-views";
import { useWidgetField, type Tone } from "./widget-field";
import "@/components/onboarding/onboarding.css";
import "@/components/settings/settings.css";
import "./widgets.css";

/* ---------------------------------------------------------------------------
   The widgets of the conversation page (user request, 2026-10-06): excerpts
   of the plugins — their most important elements — that FLOAT on the page's
   own ground along its borders, from the top right; the user drags each
   one along them (no column of their own: the user refused it). Where they
   stand and the room they leave the conversation are pure functions of
   lib/widgets/catalog.ts; this file only draws them and hands that room
   to widgets.css. Apple's three sizes; frosted cards over the app's light (one WebGL
   field under all of them, `widget-field.ts`); titles in BytNode's ink.

   The header's widgets button opens a small menu (`WidgetsMenu`): show or
   hide them, add one (the gallery: every widget of a plugin that runs,
   live, in the size chosen), edit them (Apple's jiggle, − to remove,
   S / M / L). A press that does not move opens the widget's plugin tab;
   a press that moves carries it. The same widgets in every conversation,
   with their places (`agentchat:widgets`).
--------------------------------------------------------------------------- */

/* The sizes' words (`m.widgets.sizes`, one letter each in `sizeLetters`)
   are read at render, in the interface's language. */
/** The right-click menu's width, kept inside the page. */
const CTX_WIDTH = 200;
/** Moved further than this, a press is a drag, not a click. */
const DRAG_FROM = 4;

/* --- The page, as the widgets see it ---------------------------------------------- */

/** The widgets' button, in screen pixels from the page's top RIGHT corner:
    it is FIXED there (`.wgm`, widgets.css — the one thing that never
    moves, user request) and no widget may cover it; reserved wide enough
    for « Done », which takes its place while editing. */
const BUTTON = { right: 14, top: 12, w: 96, h: 50 };

/** The screen page: its size and its parts' NATURAL measures, in screen
    pixels — none of them changes with the room the widgets take (they set
    margins and side paddings only): the head's height (margin excluded),
    the title's ink span, the conversation's column, the inner margins
    above the title and the thread's text and under the composer. */
type Screen = Area & { head: number; title: Span; column: number; pad: { head: number; thread: number; composer: number } };

const SCREEN0: Screen = { width: 0, height: 0, head: 90, title: { left: 30, right: 300 }, column: 736, pad: { head: 20, thread: 12, composer: 14 } };

/** The page at the widgets' scale `k` (`Page`, lib/widgets/catalog.ts):
    plain arithmetic on the page's size and the head's height — nothing the
    layout itself moves is ever measured (measuring the moved parts made
    them chase their own shadow). */
function pageAt(screen: Screen): { k: number; page: Page } {
  const k = widgetScale(screen);
  return {
    k,
    page: {
      area: logicalArea(screen, k),
      head: screen.head / k,
      title: { left: screen.title.left / k, right: screen.title.right / k },
      column: { left: (screen.width - screen.column) / 2 / k, right: (screen.width + screen.column) / 2 / k },
      pad: { head: screen.pad.head / k, thread: screen.pad.thread / k, composer: screen.pad.composer / k },
      blocked: [{ x: (screen.width - BUTTON.right - BUTTON.w) / k, y: BUTTON.top / k, w: BUTTON.w / k, h: BUTTON.h / k }],
    },
  };
}

/** The screen page of the layer `el` (the conversation page's own). */
function screenOf(el: HTMLElement | null): Screen {
  const main = el?.parentElement;
  if (!el || !main) return { ...SCREEN0, width: 1200, height: 800 };
  const top = main.querySelector<HTMLElement>(":scope > .chat-top");
  const thread = main.querySelector<HTMLElement>(":scope > .thread-wrap > .thread");
  const composer = main.querySelector<HTMLElement>(":scope > .chat-composer");
  const px = (v: string | undefined, or: number) => (v === undefined ? or : parseFloat(v) || 0);
  /* The title's ink — its text, not its box (the box spans the head) —
     from the head's natural left padding. */
  let ink = 0;
  for (const t of Array.from(main.querySelectorAll(":scope > .chat-top .chat-title, :scope > .chat-top .chat-sub"))) {
    const range = document.createRange();
    range.selectNodeContents(t);
    ink = Math.max(ink, range.getBoundingClientRect().width);
  }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const columnMax = parseFloat(getComputedStyle(main).getPropertyValue("--thread")) * rem || 736;
  return {
    width: el.clientWidth,
    height: el.clientHeight,
    head: top?.offsetHeight ?? SCREEN0.head,
    title: { left: 30, right: 30 + ink },
    column: Math.min(columnMax, el.clientWidth - 56),
    pad: {
      head: px(top ? getComputedStyle(top).paddingTop : undefined, SCREEN0.pad.head),
      thread: px(thread ? getComputedStyle(thread).paddingTop : undefined, SCREEN0.pad.thread),
      composer: px(composer ? getComputedStyle(composer).paddingBottom : undefined, SCREEN0.pad.composer),
    },
  };
}

/* --- The header's button and its menu ----------------------------------------- */

export function WidgetsMenu({ open, editing, onEdit, onAdd }: { open: boolean; editing: boolean; onEdit: (on: boolean) => void; onAdd: () => void }) {
  const m = useMessages();
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setMenu(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const pick = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  /* Widgets hidden one by one (their right-click menu) come back here. */
  const hidden = useWidgets().items.filter((w) => w.hidden).length;
  return (
    <div className="wgm" ref={root}>
      {/* Editing: « Done » takes the button's place — nothing can be added
          while the widgets are being edited (user request). */}
      {editing ? (
        <button type="button" className="wgm-done" onClick={() => onEdit(false)}>
          {m.common.done}
        </button>
      ) : (
        <button type="button" className={`chat-widgets${open ? " is-on" : ""}`} onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu} aria-label={m.widgets.title} title={m.widgets.title}>
          <WidgetsIcon />
        </button>
      )}
      {menu && !editing && (
        <div className="wgm-pop" role="menu">
          <button type="button" role="menuitem" onClick={pick(onAdd)}>
            <Plus />
            {m.widgets.addWidget}
          </button>
          <button type="button" role="menuitem" disabled={!open} onClick={pick(() => onEdit(!editing))}>
            <Pencil />
            {editing ? m.widgets.doneEditing : m.widgets.editWidgets}
          </button>
          <button type="button" role="menuitem" onClick={pick(() => updateWidgets((s) => ({ ...s, open: !s.open })))}>
            {open ? <EyeOff /> : <Eye />}
            {open ? m.widgets.hideWidgets : m.widgets.showWidgets}
          </button>
          {hidden > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={pick(() => {
                const { page } = pageAt(screenOf(document.querySelector<HTMLElement>(".chat-main > .wgl")));
                updateWidgets((s) => ({ ...s, open: true, area: page.area, items: showHidden(fitWidgets(s.items, s.area, page), page) }));
              })}
            >
              <Eye />
              {m.widgets.showHidden(hidden)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* --- The layer they float on ------------------------------------------------------ */

type Props = { settings: Settings; active: boolean; editing: boolean; onEdit: (on: boolean) => void };

export function WidgetsLayer({ settings, active, editing, onEdit }: Props) {
  const m = useMessages();
  const state = useWidgets();
  const { open, items: stored, area: placedIn } = state;
  const [tones, setTones] = useState<Record<string, Tone>>({});
  /* The page on screen; the widgets are drawn at the scale it gives (user
     request: smaller in a small window, larger in a large one) and placed
     in their own pixels (`page.area`). */
  const [screen, setScreen] = useState<Screen>(SCREEN0);
  const { k, page } = useMemo(() => pageAt(screen), [screen]);
  /* The widget the hand carries, and where it is now. */
  const [drag, setDrag] = useState<{ id: string } & Position | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cards = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: string; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);

  const running = useMemo(() => new Set(enabledPlugins(PLUGIN_MANIFESTS, settings.plugins)), [settings.plugins]);
  /* The places carried to the page as it is now (`fitWidgets`, pure: what
     is shown is exactly what an edit starts from). */
  const items = useMemo(() => fitWidgets(stored, placedIn, page), [stored, placedIn, page]);
  /* A widget whose plugin was switched off waits, hidden, for it. */
  /* …and one switched off in Settings → Widgets, for its switch. */
  const shown = open ? items.filter((w) => !w.hidden && widgetOn(state, w.kind) && running.has(widgetInfo(w.kind)?.plugin ?? "")) : [];
  /* ⚠️ Drawn in a STABLE order (by id), stacked by their place in the list:
     moving a card in the DOM to bring it on top restarted its CSS
     animations — a blink at every release (user report). */
  const drawn = [...shown].sort((a, b) => (a.id < b.id ? -1 : 1));
  const layerOf = new Map(shown.map((w, i) => [w.id, i + 1]));

  /* The conversation's room (`roomFor`): a pure function of the places,
     the page and the head's height, handed to widgets.css as CSS variables
     on the page, in screen pixels. Hidden widgets leave the page as it
     was. */
  const room = roomFor(shown, page);
  const roomKey = [room.top, room.thread, room.bottom, room.head.left, room.head.right, room.body.left, room.body.right].map((v) => Math.round(v * k)).join(" ");
  useEffect(() => {
    const main = layer.current?.parentElement;
    if (!main) return;
    const [top, thread, bottom, headL, headR, bodyL, bodyR] = roomKey.split(" ");
    for (const [name, v] of [["top", top], ["thread", thread], ["bottom", bottom], ["head-l", headL], ["head-r", headR], ["body-l", bodyL], ["body-r", bodyR]])
      main.style.setProperty(`--wg-${name}`, `${v}px`);
  }, [roomKey]);

  /* Gone (an agent's page, the layer unmounted): the page as it was. */
  useEffect(() => {
    const main = layer.current?.parentElement;
    return () => {
      if (!main) return;
      for (const name of ["top", "thread", "bottom", "head-l", "head-r", "body-l", "body-r"]) main.style.removeProperty(`--wg-${name}`);
    };
  }, []);

  /* The page's size and its head's height, as they change. */
  useEffect(() => {
    const el = layer.current;
    const top = el?.parentElement?.querySelector(":scope > .chat-top");
    if (!el) return;
    const read = () => {
      const next = screenOf(el);
      setScreen((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (top) ro.observe(top);
    return () => ro.disconnect();
  }, []);

  useWidgetField(canvas, cards, tones, active && shown.length > 0);

  const toneOf = useCallback((id: string, tone: Tone) => {
    setTones((prev) => {
      const old = prev[id];
      if (old && old.strength === tone.strength && old.rgb.every((v, i) => v === tone.rgb[i])) return prev;
      return { ...prev, [id]: tone };
    });
  }, []);

  /* --- Carrying a widget ----------------------------------------------------- */

  const down = (w: PlacedWidget) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("input, button, select, textarea")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: w.id, sx: e.clientX, sy: e.clientY, x: w.x, y: w.y, moved: false };
  };
  const move = (w: PlacedWidget) => (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || p.id !== w.id) return;
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_FROM) return;
    p.moved = true;
    /* Anywhere in the page (user request: no invisible wall); the rules
       apply when it is let go — it then glides to its place. */
    setDrag({ id: w.id, ...insidePage({ x: p.x + (e.clientX - p.sx) / k, y: p.y + (e.clientY - p.sy) / k }, w.size, page.area) });
  };
  const up = (w: PlacedWidget) => () => {
    const p = press.current;
    press.current = null;
    if (!p || p.id !== w.id) return;
    if (p.moved && drag) {
      updateWidgets((s) => ({ ...s, area: page.area, items: moveWidgetTo(fitWidgets(s.items, s.area, page), w.id, drag, page) }));
    }
    else if (!p.moved && !editing) {
      const view = widgetInfo(w.kind)?.view;
      if (view) openView(view);
    }
    setDrag(null);
  };

  /* --- Its right-click menu (user request): size, edit, hide, remove ---------- */

  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const ctxRoot = useRef<HTMLDivElement>(null);
  const closeCtx = useCallback(() => setCtx(null), []);
  useDismiss(ctx !== null, closeCtx, ctxRoot);
  useEffect(() => {
    if (!ctx) return;
    window.addEventListener("wheel", closeCtx, { passive: true });
    window.addEventListener("resize", closeCtx);
    return () => {
      window.removeEventListener("wheel", closeCtx);
      window.removeEventListener("resize", closeCtx);
    };
  }, [ctx, closeCtx]);
  const openCtx = (w: PlacedWidget) => (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    const box = layer.current?.getBoundingClientRect();
    if (!box) return;
    /* Where the click was, in the page, kept inside it. */
    setCtx({ id: w.id, x: Math.max(8, Math.min(e.clientX - box.left, box.width - CTX_WIDTH - 8)), y: Math.max(8, Math.min(e.clientY - box.top, box.height - 240)) });
  };
  const ctxWidget = ctx ? shown.find((w) => w.id === ctx.id) : undefined;
  const ctxInfo = ctxWidget ? widgetInfo(ctxWidget.kind) : undefined;
  const act = (fn: () => void) => () => {
    setCtx(null);
    fn();
  };

  return (
    <>
      {/* Hidden: wholly hidden — the layer, its light and its cards. */}
      <div className={`wgl wg${editing ? " is-editing" : ""}`} ref={layer} aria-label={m.widgets.title} hidden={!open}>
      <ViewActive value={active}>
        <canvas ref={canvas} className="wg-field" aria-hidden />
        {/* Drawn at the page's scale: `zoom` scales the cards, their
            places and their contents together (the light under them reads
            their boxes on screen). */}
        <div className="wgl-cards" ref={cards} style={{ zoom: k }}>
          {drawn.map((w) => {
            const at = drag?.id === w.id ? drag : w;
            const px = SIZE_PX[w.size];
            const info = widgetInfo(w.kind)!;
            return (
              <article
                key={w.id}
                className={`wg-card is-${w.size}${drag?.id === w.id ? " is-carried" : ""}${info.view && !editing ? " is-link" : ""}`}
                data-widget={w.id}
                data-size={w.size}
                style={{ left: at.x, top: at.y, width: px.w, height: px.h, zIndex: drag?.id === w.id ? 999 : layerOf.get(w.id) }}
                onPointerDown={down(w)}
                onPointerMove={move(w)}
                onPointerUp={up(w)}
                onPointerCancel={() => {
                  press.current = null;
                  setDrag(null);
                }}
                onContextMenu={openCtx(w)}
              >
                <div className="wg-card-in">
                  <WidgetBody kind={w.kind} size={w.size} settings={settings} onTone={(t) => toneOf(w.id, t)} />
                </div>
                {editing && (
                  <>
                    <button type="button" className="wg-remove" onClick={() => updateWidgets((s) => ({ ...s, items: removeWidget(s.items, w.id) }))} aria-label={m.widgets.removeNamed(m.widgets.kinds[w.kind].name)}>
                      <span />
                    </button>
                    {info.sizes.length > 1 && (
                      <div className="wg-sizes" role="radiogroup" aria-label={m.widgets.size}>
                        {info.sizes.map((s) => (
                          <button key={s} type="button" role="radio" aria-checked={w.size === s} className={w.size === s ? "is-on" : undefined} onClick={() => {
                            updateWidgets((st) => ({ ...st, area: page.area, items: resizeWidget(fitWidgets(st.items, st.area, page), w.id, s, page) }));
                          }}>
                            {m.widgets.sizeLetters[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
        {ctx && ctxWidget && ctxInfo && (
          <div ref={ctxRoot} className="wg-ctx" role="menu" aria-label={m.widgets.menuOf(m.widgets.kinds[ctxInfo.kind].name)} style={{ left: ctx.x, top: ctx.y, width: CTX_WIDTH }} onContextMenu={(e) => e.preventDefault()}>
            {ctxInfo.sizes.length > 1 &&
              ctxInfo.sizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="menuitemradio"
                  aria-checked={ctxWidget.size === size}
                  className={ctxWidget.size === size ? "is-on" : undefined}
                  onClick={act(() => updateWidgets((st) => ({ ...st, area: page.area, items: resizeWidget(fitWidgets(st.items, st.area, page), ctxWidget.id, size, page) })))}
                >
                  <span className="wg-ctx-check">{ctxWidget.size === size && <Check />}</span>
                  {m.widgets.sizes[size]}
                </button>
              ))}
            {ctxInfo.sizes.length > 1 && <hr />}
            <button type="button" role="menuitem" onClick={act(() => onEdit(true))}>
              <Pencil />
              {m.widgets.editWidgets}
            </button>
            <button type="button" role="menuitem" onClick={act(() => updateWidgets((st) => ({ ...st, items: hideWidget(st.items, ctxWidget.id) })))}>
              <EyeOff />
              {m.widgets.hideWidget}
            </button>
            <button type="button" role="menuitem" className="is-danger" onClick={act(() => updateWidgets((st) => ({ ...st, items: removeWidget(st.items, ctxWidget.id) })))}>
              <Trash />
              {m.widgets.removeWidget}
            </button>
          </div>
        )}
      </ViewActive>
      </div>
    </>
  );
}

/** The gallery, rendered where the settings panel is (the chat page's
    root): the widgets' layer lets the hand through and makes its own
    stacking, the gallery must cover the whole app. A widget added goes to
    the first free place of the page as it is now. */
export function WidgetsGallery({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const running = useMemo(() => new Set(enabledPlugins(PLUGIN_MANIFESTS, settings.plugins)), [settings.plugins]);
  const state = useWidgets();
  const offered = WIDGETS.filter((w) => running.has(w.plugin) && widgetOn(state, w.kind));
  return (
    <Gallery
      settings={settings}
      offered={offered}
      onAdd={(kind, size) => {
        const { page } = pageAt(screenOf(document.querySelector<HTMLElement>(".chat-main > .wgl")));
        updateWidgets((s) => ({ ...s, open: true, area: page.area, items: addWidget(fitWidgets(s.items, s.area, page), { id: newId(), kind, size }, page) }));
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/* --- The gallery: the settings panel's own language (user request) ----------- */

/* Opaque, laid on the dimmed page, a navigation column on the left — the
   widgets, each with its plugin's icon — and on the right the chosen one:
   its title and what it shows, its size as the settings' segmented
   control, the widget itself live at that size, and the button to add it.
   The same classes as `settings-panel.tsx` (`.ob.st-veil`, `.st`,
   `.st-nav`, `.st-main`, `.st-section`, `.st-row`, `.st-seg`). */
function Gallery({ settings, offered, onAdd, onClose }: { settings: Settings; offered: WidgetInfo[]; onAdd: (kind: WidgetInfo["kind"], size: WidgetSize) => void; onClose: () => void }) {
  const m = useMessages();
  const [pick, setPick] = useState<WidgetInfo | null>(offered[0] ?? null);
  const [size, setSize] = useState<WidgetSize>(offered[0]?.sizes[0] ?? "small");
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const choose = (w: WidgetInfo) => {
    setPick(w);
    setSize(w.sizes.includes(size) ? size : w.sizes[0]);
  };
  return (
    <div className="ob st-veil wg-gallery" role="dialog" aria-modal="true" aria-labelledby="wg-gallery-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st">
        <button type="button" className="st-close" onClick={onClose} aria-label={m.common.close}>
          <Close />
        </button>
        <nav className="st-nav" aria-label={m.widgets.title}>
          <span className="st-nav-title">{m.widgets.title}</span>
          {offered.map((w) => (
            <button key={w.kind} type="button" className={`st-nav-item wg-nav-item${pick?.kind === w.kind ? " is-on" : ""}`} aria-current={pick?.kind === w.kind ? "page" : undefined} onClick={() => choose(w)}>
              <TabIcon view={w.view ?? "position-calc"} />
              {m.widgets.kinds[w.kind].name}
            </button>
          ))}
        </nav>
        <div className="st-main">
          <div className="st-content" key={pick?.kind ?? "none"}>
            {!pick ? (
              <>
                <h1 id="wg-gallery-title" className="st-title">
                  {m.widgets.addWidget}
                </h1>
                <p className="st-lede">{m.widgets.nothingToAdd}</p>
              </>
            ) : (
              <>
                <div className="st-head">
                  <h1 id="wg-gallery-title" className="st-title">
                    {m.widgets.kinds[pick.kind].name}
                  </h1>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onAdd(pick.kind, size)}>
                    <Plus />
                    {m.widgets.add}
                  </button>
                </div>
                <p className="st-lede">{m.widgets.kinds[pick.kind].description}</p>
                <section className="st-section">
                  <h2 className="st-section-title">{m.widgets.size}</h2>
                  <div className="st-row">
                    <div className="st-row-text">
                      <span className="st-row-label">{m.widgets.size}</span>
                      <p className="st-row-hint">{m.widgets.sizeHint}</p>
                    </div>
                    <div className="st-row-control">
                      <div className="st-seg" role="radiogroup" aria-label={m.widgets.size}>
                        {SIZES.filter((s) => pick.sizes.includes(s)).map((s) => (
                          <button key={s} type="button" role="radio" aria-checked={size === s} className={`st-seg-btn${size === s ? " is-on" : ""}`} onClick={() => setSize(s)}>
                            {m.widgets.sizes[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
                <section className="st-section">
                  <h2 className="st-section-title">{m.widgets.preview}</h2>
                  {/* The widget itself, live, at that size. */}
                  <div className="wg wg-preview">
                    <div className={`wg-card is-${size}`} style={{ width: SIZE_PX[size].w, height: SIZE_PX[size].h }}>
                      <div className="wg-card-in">
                        <WidgetBody kind={pick.kind} size={size} settings={settings} onTone={noTone} />
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const noTone = () => {};
