"use client";

import { useEffect, useState } from "react";

/* ---------------------------------------------------------------------------
   Text that writes itself, as if it were being said (user request,
   2026-10-09: the companion's bubble, then the welcome in the first
   conversation — « s'écrive petit à petit comme s'il parlait »).

   Time-driven, not tick-driven: the length shown is what `cps` characters a
   second give since the start, so a slow frame never slows the speech, it
   only skips ahead. Letter by letter (« plus fluide, pas petit bloc après
   petit bloc »); Markdown stays whole through `markdownPrefix`.

   `waitForFocus`: the speech starts only when the app's window is in front
   and seen — not while the user is still in the browser signing in
   (2026-10-09). Under `prefers-reduced-motion`, everything at once.
--------------------------------------------------------------------------- */

export type Typed = { shown: string; done: boolean };

/** How much of `text` is shown `elapsed` ms after the start. Pure. */
export function typedLength(text: string, elapsed: number, cps: number, words: boolean): number {
  if (elapsed <= 0) return 0;
  const n = Math.min(text.length, Math.floor((elapsed * cps) / 1000));
  if (!words || n >= text.length) return n;
  const cut = text.lastIndexOf(" ", n);
  const nl = text.lastIndexOf("\n", n);
  return Math.max(0, cut, nl);
}

/** The first `n` characters of a Markdown text, written so they render
    cleanly mid-way: no stray `*` of a marker being typed, and an open
    `**bold` closed for now (it reads bold as it is written, never as
    asterisks). Pure. */
export function markdownPrefix(text: string, n: number): string {
  const s = text.slice(0, n).replace(/\*+$/, "");
  return (s.match(/\*\*/g) ?? []).length % 2 ? `${s}**` : s;
}

/** Is the app in front and seen? */
const inFront = () => document.visibilityState === "visible" && document.hasFocus();

export function useTypewriter(text: string, opts: { enabled: boolean; cps: number; delay?: number; words?: boolean; waitForFocus?: boolean }): Typed {
  const { enabled, cps, delay = 0, words = false, waitForFocus = false } = opts;
  /* The progress is kept WITH the text it belongs to: a new text starts
     from nothing without a reset in the effect's body. */
  const [progress, setProgress] = useState({ text: "", n: 0 });

  useEffect(() => {
    if (!enabled) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      const n = still ? text.length : typedLength(text, now - start, cps, words);
      setProgress({ text, n });
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    const begin = () => {
      start = performance.now() + delay;
      raf = requestAnimationFrame(tick);
    };
    if (!waitForFocus || inFront()) {
      begin();
      return () => cancelAnimationFrame(raf);
    }
    const onBack = () => {
      if (!inFront()) return;
      stop();
      begin();
    };
    const stop = () => {
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      stop();
      cancelAnimationFrame(raf);
    };
  }, [text, enabled, cps, delay, words, waitForFocus]);

  const n = !enabled ? text.length : progress.text === text ? progress.n : 0;
  return { shown: text.slice(0, n), done: n >= text.length };
}
