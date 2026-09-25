"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

/* ---------------------------------------------------------------------------
   A popover of the composer: a pane of the same frosted glass, rising
   above the composer on its trigger's side with a short scale-in.

   It closes on its own, as a menu should: a press anywhere but inside it or
   on its trigger (the trigger toggles it itself), Escape (focus goes back
   to the field), or whatever the composer decides — typing, or a click in
   the field, closes it too (`composer.tsx`); a letter typed while one of
   its rows has focus closes it as well and lands in the field. ↑ ↓ move
   between its rows
   (`[data-item]`), and the first one takes focus on opening unless a search
   field is there to take it.
--------------------------------------------------------------------------- */

type Props = {
  open: boolean;
  onClose: (refocus: boolean) => void;
  /** The button that opens it: a press on it is not "outside". */
  anchor: RefObject<HTMLElement | null>;
  align: "start" | "end";
  width: number;
  label: string;
  /** Changes when the popover shows another page: focus moves to it. */
  page?: string;
  className?: string;
  children: ReactNode;
};

export function ComposerPopover({ open, onClose, anchor, align, width, label, page, className, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  /* The latest `onClose`, so the listeners are set once per opening. */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || anchor.current?.contains(t)) return;
      closeRef.current(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current(true);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor]);

  /* On opening, and on each page: its search field, else its first row. */
  useEffect(() => {
    if (!open) return;
    const el = root.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("[data-item]:not(:disabled)"))?.focus({ preventScroll: true });
  }, [open, page]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    /* A letter typed on a row means the user is writing: the popover goes
       and focus returns to the field before the key lands, so the letter
       is written there. A search field keeps its letters. */
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement) && e.key !== " ") {
      closeRef.current(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-item]:not(:disabled), [data-autofocus]") ?? []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1;
    items[next]?.focus();
  };

  return (
    <div ref={root} className={`cmp-pop is-${align}${className ? ` ${className}` : ""}`} style={{ width }} role="dialog" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
