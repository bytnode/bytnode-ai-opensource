"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { WRITABLE, type Category } from "@/lib/plugins/calendar/events";
import { useDismiss } from "@/components/ui/use-dismiss";
import { useCalendarActions } from "./actions";
import { SHORT } from "./filters";
import { LOCALE, TONE } from "./format";

/* The user's own entry, added from an hour of the agenda: a bubble under
   the hour pressed — a name, a calendar (the theme, in its colour), a
   description, the time (the hour pressed, to the minute if need be) —
   then "Add". It needs no source: the user vouches for it. Escape or a
   press outside closes it; what was typed is lost, like Calendar's. */

type Props = {
  day: Date;
  hour: number;
  /** Opens towards the inside of the week (its last days). */
  flip?: boolean;
  /** Opens above the hour (the evening: below, it would leave the pane). */
  up?: boolean;
  onClose: () => void;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function NewEntry({ day, hour, flip, up, onClose }: Props) {
  const { add } = useCalendarActions();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("task");
  const [notes, setNotes] = useState("");
  const [time, setTime] = useState(`${pad(hour)}:00`);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(true, close, root);

  const submit = async () => {
    const [h, m] = time.split(":").map(Number);
    if (!title.trim() || !Number.isFinite(h) || !Number.isFinite(m)) return;
    setBusy(true);
    const p = await add({ startsAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString(), category, title: title.trim(), notes: notes.trim() });
    setBusy(false);
    if (p) setProblem(p);
    else onClose();
  };

  return (
    <form
      ref={root}
      className={`calv-pop calv-new${flip ? " is-flipped" : ""}${up ? " is-up" : ""}`}
      aria-label="New event"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="calv-new-when">{day.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}</p>
      <input className="calv-new-title" aria-label="Name" placeholder="Name" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
      <div className="calv-new-themes" role="radiogroup" aria-label="Theme">
        {WRITABLE.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} className={`calv-new-theme${category === c ? " is-on" : ""}`} style={{ "--tone": TONE[c] } as CSSProperties} onClick={() => setCategory(c)}>
            <span className="calv-filter-dot" aria-hidden />
            {SHORT[c]}
          </button>
        ))}
      </div>
      <textarea className="calv-new-notes" aria-label="Description" placeholder="Description" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="calv-new-foot">
        <input className="calv-new-time" type="time" aria-label="Time" value={time} required onChange={(e) => setTime(e.target.value)} />
        <span className="calv-spacer" />
        <button type="button" className="calv-fact-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="calv-fact-btn is-primary" disabled={busy || !title.trim()}>
          Add
        </button>
      </div>
      {problem && <p className="calv-new-problem">{problem}</p>}
    </form>
  );
}
