"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useMessages } from "@/lib/i18n/react";
import { TabIcon } from "./tab-icons";

/* ---------------------------------------------------------------------------
   A tab's preview, as Edge's: the hand rests on a tab for 300 ms and a card
   opens under it — a picture of the page, its icon and title, a line of
   what it shows, and for a tab behind, that it sleeps (a view behind stops
   its timers and catches up when it comes back). Moving to the next tab
   while a card is open shows that one at once; a click, a scroll of the
   bar or a resize close it.

   The picture is the page itself, copied and scaled down at that moment:
   every open page stays mounted (`app-shell.tsx`, `data-view`), so the
   copy shows it as it is, even asleep. Canvases are copied pixel by pixel
   (a chart); a WebGL one may come out blank. The copy is inert and hidden
   from assistive technology.
--------------------------------------------------------------------------- */

const DELAY = 300;
const WIDTH = 320;
const MARGIN = 8;

export type Peek = { view: string; left: number; top: number };

export function useTabPreview() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const timer = useRef<number | null>(null);
  const open = useRef(false);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = useCallback(() => {
    clear();
    open.current = false;
    setPeek(null);
  }, []);
  const enter = useCallback((view: string, el: HTMLElement) => {
    clear();
    const place = () => {
      const r = el.getBoundingClientRect();
      open.current = true;
      setPeek({ view, left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - WIDTH - MARGIN)), top: r.bottom + 6 });
    };
    /* A card already open follows the hand at once. */
    if (open.current) place();
    else timer.current = window.setTimeout(place, DELAY);
  }, []);
  const leave = useCallback(() => {
    clear();
    /* A short grace: the hand crossing to the next tab keeps the card. */
    timer.current = window.setTimeout(() => {
      open.current = false;
      setPeek(null);
    }, 120);
  }, []);

  useEffect(() => {
    if (!peek) return;
    window.addEventListener("resize", hide);
    return () => window.removeEventListener("resize", hide);
  }, [peek, hide]);
  useEffect(() => () => clear(), []);

  return { peek, enter, leave, hide };
}

type Props = { peek: Peek; title: string; description: string; asleep: boolean };

export function TabPreview({ peek, title, description, asleep }: Props) {
  const m = useMessages();
  return (
    <div className="tb-peek" style={{ left: peek.left, top: peek.top, width: WIDTH } as CSSProperties} aria-hidden>
      <Shot view={peek.view} />
      <div className="tb-peek-text">
        <b>{title}</b>
        <span className="tb-peek-line">
          <TabIcon view={peek.view} className="tb-peek-icon" />
          <span>{description}</span>
        </span>
      </div>
      {asleep && (
        <p className="tb-peek-sleep">
          <span className="tb-peek-dot" aria-hidden />
          {m.shell.asleep}
        </p>
      )}
    </div>
  );
}

/** The page, copied and scaled to the card's width (its top shown). */
function Shot({ view }: { view: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = box.current;
    const pane = document.querySelector<HTMLElement>(`.shell-pane[data-view="${CSS.escape(view)}"]`);
    if (!host || !pane || !pane.offsetWidth) return;
    const w = pane.offsetWidth;
    const h = pane.offsetHeight;
    const copy = pane.cloneNode(true) as HTMLElement;
    copy.removeAttribute("hidden");
    copy.removeAttribute("data-view");
    copy.setAttribute("inert", "");
    copy.style.cssText = `position:absolute;left:0;top:0;right:auto;bottom:auto;width:${w}px;height:${h}px;transform:scale(${host.clientWidth / w});transform-origin:0 0;visibility:visible;pointer-events:none;`;
    /* A canvas is copied empty: its pixels are drawn into the copy. */
    const from = pane.querySelectorAll("canvas");
    copy.querySelectorAll("canvas").forEach((c, i) => {
      try {
        c.getContext("2d")?.drawImage(from[i], 0, 0);
      } catch {
        /* a canvas that cannot be read stays blank */
      }
    });
    host.replaceChildren(copy);
    return () => host.replaceChildren();
  }, [view]);
  return <div className="tb-peek-shot" ref={box} />;
}
