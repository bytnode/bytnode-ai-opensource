"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Eye, Trash } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/use-dismiss";

/* The menu a right click opens on an asset — a row of the list or a tile
   of the heat map: show it, or remove it from the watchlist. A bubble
   like the calendar's, where the click was; Escape, a click elsewhere or
   the wheel close it; ↑ ↓ move between its two items.

   ⚠️ It is drawn at the view's root, not inside a pane: the panes have a
   `backdrop-filter`, which would make them the containing block of a
   `position: fixed` bubble. And the bare views are zoomed (90 %): the
   click's screen coordinates are divided by the zoom. */

export type MenuAt = { symbol: string; x: number; y: number };

/** The bubble's size, to keep it inside the window. */
const WIDTH = 230;
const HEIGHT = 96;

export function useAssetMenu() {
  const [at, setAt] = useState<MenuAt | null>(null);
  const open = useCallback((e: ReactMouseEvent<HTMLElement>, symbol: string) => {
    e.preventDefault();
    const host = e.currentTarget.closest<HTMLElement>(".pv-bare");
    const zoom = host ? host.getBoundingClientRect().width / (host.offsetWidth || 1) || 1 : 1;
    /* A keyboard's menu key gives no coordinates: the element's corner. */
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX || r.left + 12) / zoom;
    const y = (e.clientY || r.top + r.height / 2) / zoom;
    /* Kept inside the window, in the view's pixels. */
    setAt({ symbol, x: Math.max(8, Math.min(x, window.innerWidth / zoom - WIDTH - 8)), y: Math.max(8, Math.min(y, window.innerHeight / zoom - HEIGHT - 8)) });
  }, []);
  const close = useCallback(() => setAt(null), []);
  return { at, open, close };
}

type Props = { at: MenuAt; onClose: () => void; onShow: (symbol: string) => void; onRemove: (symbol: string) => void };

export function AssetMenu({ at, onClose, onShow, onRemove }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, root);

  /* The first item takes the focus; the wheel closes the menu. */
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const wheel = () => onClose();
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("resize", wheel);
    return () => {
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", wheel);
    };
  }, [onClose]);

  const base = at.symbol.split("/")[0];
  const style: CSSProperties = { left: at.x, top: at.y };
  const run = (fn: (s: string) => void) => () => {
    fn(at.symbol);
    onClose();
  };
  return (
    <div
      ref={root}
      className="wlv-menu"
      role="menu"
      aria-label={`${at.symbol} actions`}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }}
    >
      <button type="button" role="menuitem" className="wlv-menu-item" onClick={run(onShow)}>
        <Eye />
        Show {base}
      </button>
      <button type="button" role="menuitem" className="wlv-menu-item is-danger" onClick={run(onRemove)}>
        <Trash />
        Remove from watchlist
      </button>
    </div>
  );
}
