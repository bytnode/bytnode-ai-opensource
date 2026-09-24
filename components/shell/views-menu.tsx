"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ViewEntry } from "@/lib/plugins/catalog";
import { Plus } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/use-dismiss";
import { TabIcon } from "./tab-icons";

/* ---------------------------------------------------------------------------
   The tab bar's "+": the views of the plugins that run, in a bubble of the
   app's own — each its icon, its title and what it shows in one line; the
   ones already open say so, the one in front is lit. The bubble opens
   under "+" and is kept inside the window (it is `fixed`, placed from the
   button); Escape, a click elsewhere, a resize close it; ↑ ↓ move.
--------------------------------------------------------------------------- */

type Props = { views: ViewEntry[]; open: string[]; active: string; onPick: (view: string) => void };

const WIDTH = 320;
const MARGIN = 8;

export function ViewsMenu({ views, open, active, onPick }: Props) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);
  useDismiss(at !== null, close, root);

  useEffect(() => {
    if (!at) return;
    list.current?.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [at, close]);

  const toggle = (button: HTMLButtonElement) => {
    if (at) return close();
    const r = button.getBoundingClientRect();
    /* Under "+", its left edge on the button's, moved back inside the window. */
    setAt({ left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - WIDTH - MARGIN)), top: r.bottom + 6 });
  };

  return (
    <div className="tb-add" ref={root}>
      <button type="button" className={`tb-icon${at ? " is-on" : ""}`} onClick={(e) => toggle(e.currentTarget)} aria-haspopup="menu" aria-expanded={at !== null} aria-label="Open a view" title="Open a view">
        <Plus />
      </button>
      {at && (
        <div
          ref={list}
          className="tb-menu"
          role="menu"
          aria-label="Views"
          style={{ left: at.left, top: at.top, width: WIDTH } as CSSProperties}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          <p className="tb-menu-title">Open a view</p>
          {views.length === 0 ? (
            <p className="tb-menu-empty">No view yet: switch on a plugin that has one, in Settings → Plugins.</p>
          ) : (
            views.map((v) => {
              const isOpen = open.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  role="menuitem"
                  className={`tb-menu-item${active === v.id ? " is-on" : ""}`}
                  onClick={() => {
                    onPick(v.id);
                    close();
                  }}
                >
                  <span className="tb-menu-icon" aria-hidden>
                    <TabIcon view={v.id} />
                  </span>
                  <span className="tb-menu-text">
                    <b>{v.title}</b>
                    <small>{v.description}</small>
                  </span>
                  {isOpen && <span className="tb-menu-tag">{active === v.id ? "Here" : "Open"}</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
