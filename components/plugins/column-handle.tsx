"use client";

import type { KeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";

/* ---------------------------------------------------------------------------
   The rule between a bare view's two columns, as a handle: drag it (or
   focus it and use the arrows; double-click to reset) to widen or narrow
   the left column. While dragging, the column follows the mouse through a
   CSS variable set on the panel itself — no render — and the width is
   kept on release (`lib/state/ui.ts`).
--------------------------------------------------------------------------- */

type Props = {
  /** The panel whose `cssVar` sets the left column's width. */
  panel: RefObject<HTMLElement | null>;
  cssVar: string;
  width: number;
  min: number;
  max: number;
  reset: number;
  clamp: (w: number) => number;
  onCommit: (w: number) => void;
  label: string;
};

export function ColumnHandle({ panel, cssVar, width, min, max, reset, clamp, onCommit, label }: Props) {
  const start = (e: ReactMouseEvent) => {
    e.preventDefault();
    const box = panel.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    /* The mouse moves in screen pixels, the width is in the view's CSS
       pixels: a zoomed view (the bare ones are at 90 %) divides. */
    const zoom = rect.width / (box.offsetWidth || rect.width) || 1;
    let next = width;
    const move = (ev: MouseEvent) => {
      next = clamp((ev.clientX - rect.left) / zoom);
      box.style.setProperty(cssVar, `${next}px`);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("is-resizing");
      onCommit(next);
    };
    document.body.classList.add("is-resizing");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const nudge = (e: KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    onCommit(clamp(width + step));
  };
  return (
    <div
      className="pv-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize — double-click to reset"
      onMouseDown={start}
      onKeyDown={nudge}
      onDoubleClick={() => onCommit(reset)}
    />
  );
}
