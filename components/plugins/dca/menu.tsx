"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

/* The menu a right click opens on a group or a plan of the column: the
   watchlist's bubble (`wlv-menu`), where the click was, with the items the
   caller gives. Escape, a click elsewhere or the wheel close it; ↑ ↓ move.
   ⚠️ Drawn at the view's root (the panes' `backdrop-filter` would contain
   a fixed bubble) and in the view's pixels (the bare views are zoomed). */

export type MenuTarget = { kind: "group" | "plan"; id: string };
export type MenuAt = MenuTarget & { x: number; y: number };
export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void };

const WIDTH = 240;

export function useItemMenu() {
  const [at, setAt] = useState<MenuAt | null>(null);
  const open = useCallback((e: ReactMouseEvent<HTMLElement>, target: MenuTarget) => {
    e.preventDefault();
    const host = e.currentTarget.closest<HTMLElement>(".pv-bare");
    const zoom = host ? host.getBoundingClientRect().width / (host.offsetWidth || 1) || 1 : 1;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX || r.left + 12) / zoom;
    const y = (e.clientY || r.top + r.height / 2) / zoom;
    setAt({ ...target, x: Math.max(8, Math.min(x, window.innerWidth / zoom - WIDTH - 8)), y: Math.max(8, y) });
  }, []);
  const close = useCallback(() => setAt(null), []);
  return { at, open, close };
}

export function ItemMenu({ at, label, items, onClose }: { at: MenuAt; label: string; items: MenuItem[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, root);

  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    /* Kept inside the window once its height is known. */
    const el = root.current;
    if (el) {
      const host = el.closest<HTMLElement>(".pv-bare");
      const zoom = host ? host.getBoundingClientRect().width / (host.offsetWidth || 1) || 1 : 1;
      const room = window.innerHeight / zoom - el.offsetHeight - 8;
      if (at.y > room) el.style.top = `${Math.max(8, room)}px`;
    }
    const wheel = () => onClose();
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("resize", wheel);
    return () => {
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", wheel);
    };
  }, [onClose, at.y]);

  const style: CSSProperties = { left: at.x, top: at.y, width: WIDTH };
  return (
    <div
      ref={root}
      className="wlv-menu dcv-menu"
      role="menu"
      aria-label={label}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const list = [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`wlv-menu-item${item.danger ? " is-danger" : ""}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
