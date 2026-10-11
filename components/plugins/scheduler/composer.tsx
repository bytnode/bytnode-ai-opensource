"use client";

import { useState } from "react";
import type { AgentConfig, TelegramBot } from "@/lib/domain/types";
import { isFrequency, nextRun, parseFrequency } from "@/lib/plugins/core/frequency";
import { relative } from "@/lib/plugins/scheduler/timeline";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus } from "@/components/ui/icons";
import { TelegramPick, type TelegramChoice } from "./telegram-pick";
import { useMessages } from "@/lib/i18n/react";
import { dateTag } from "@/lib/i18n/store";
import { capitalize } from "@/lib/plugins/shared/frequency-words";

/* ---------------------------------------------------------------------------
   "New scheduled task", at the top of the tab — folded into one line until
   it is wanted (open from the start when there is no task yet). Open: what
   the task is called, which agent runs it, what it must do, and when —
   chosen, not typed: every few hours, every day at a time, every week on a
   day at a time, or a custom frequency for who knows the grammar. The
   first run is said before the task exists; an agent task runs at most
   every 15 minutes. One blue button schedules it.
--------------------------------------------------------------------------- */

type Mode = "hours" | "daily" | "weekly" | "custom";

const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
/** A weekday's short name in the interface's language: 1 January 2024
    was a Monday. */
const dayName = (i: number) => capitalize(new Date(2024, 0, 1 + i).toLocaleDateString(dateTag(), { weekday: "short" }));

type Props = {
  open: boolean;
  onOpen: (open: boolean) => void;
  agents: AgentConfig[];
  /** The Telegram bots a report can also go to. */
  bots: TelegramBot[];
  /** The server's now, for the next run's preview. */
  now: number | null;
  /** Schedules the task; answers why not, or null. */
  onCreate: (task: { title: string; agent: string; frequency: string; prompt: string; catchUp: "run-once-on-start" | "skip"; telegramBot?: string; report?: "full" | "short" }) => Promise<string | null>;
};

export function Composer({ open, onOpen, agents, bots, now, onCreate }: Props) {
  const t = useMessages();
  const w = t.scheduler.composer;
  const modes: Array<{ value: Mode; label: string }> = [
    { value: "hours", label: w.everyFewHours },
    { value: "daily", label: w.daily },
    { value: "weekly", label: w.weekly },
    { value: "custom", label: w.custom },
  ];
  const hourChoices = ["1", "2", "4", "6", "12"].map((h) => ({ value: h, label: h === "1" ? w.everyHour : w.hours(h) }));
  const days = WEEK.map((d, i) => ({ value: d, label: dayName(i) }));
  /* The custom frequency stays in the grammar the scheduler reads (English). */
  const hint = w.hint;
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState(agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("daily");
  const [hours, setHours] = useState("4");
  const [time, setTime] = useState("08:00");
  const [day, setDay] = useState("monday");
  const [custom, setCustom] = useState("every 30 minutes");
  const [catchUp, setCatchUp] = useState(false);
  const [telegram, setTelegram] = useState<TelegramChoice>({ bot: "", report: "full" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const frequency = mode === "hours" ? (hours === "1" ? "every hour" : `every ${hours} hours`) : mode === "daily" ? `daily at ${time}` : mode === "weekly" ? `every ${day} at ${time}` : custom.trim();
  const parsed = parseFrequency(frequency);
  const tooOften = !("error" in parsed) && parsed.kind === "interval" && parsed.minutes < 15;
  const next = now !== null && !("error" in parsed) ? relative(parsed.kind === "interval" ? now : nextRun(parsed, now), now) : null;
  const chosen = agents.find((a) => a.id === agent) ?? agents[0];
  /* What is missing, said when Schedule is pressed (user request,
     2026-10-08: a button that stays pale says nothing). */
  const why = !title.trim() ? w.giveTitle : !prompt.trim() ? w.sayWhat : !chosen ? w.createAgent : !isFrequency(frequency) ? w.unreadable : tooOften ? w.tooOften : null;

  const submit = async () => {
    if (busy) return;
    if (why || !chosen) return setProblem(why ?? w.createAgent);
    setBusy(true);
    setDone(null);
    const p = await onCreate({ title: title.trim(), agent: chosen.id, frequency, prompt: prompt.trim(), catchUp: catchUp ? "run-once-on-start" : "skip", ...(telegram.bot ? { telegramBot: telegram.bot, report: telegram.report } : {}) });
    setBusy(false);
    setProblem(p);
    if (p) return;
    setDone(next === null || next === t.scheduler.relative.now ? w.scheduledNow(title.trim()) : w.scheduled(title.trim(), next));
    setTitle("");
    setPrompt("");
    onOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="sdv-composer-open" onClick={() => onOpen(true)}>
        <Plus />
        {w.newTask}
        {done && <small>{done}</small>}
      </button>
    );
  }

  return (
    <form
      className="sdv-composer"
      aria-label={w.label}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="sdv-composer-top">
        <input className="sdv-title-input" aria-label={w.taskName} placeholder={w.taskTitle} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <div className="sdv-agent">
          <span className="sdv-label">{w.runBy}</span>
          {agents.length ? <Select id="sdv-agent" label={w.agent} value={chosen?.id ?? ""} options={agents.map((a) => ({ value: a.id, label: a.name }))} onChange={setAgent} /> : <span className="sdv-none">{w.noAgent}</span>}
        </div>
      </div>

      <textarea
        className="wlv-input sdv-prompt"
        aria-label={w.whatToDo}
        rows={3}
        placeholder={w.promptPlaceholder}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="sdv-when">
        <span className="sdv-label">{w.when}</span>
        <Segmented label={w.frequency} value={mode} options={modes} onChange={setMode} />
        <div className="sdv-when-detail">
          {mode === "hours" && <Segmented label={w.every} value={hours} options={hourChoices} onChange={setHours} />}
          {mode === "weekly" && <Segmented label={w.day} value={day} options={days} onChange={setDay} />}
          {(mode === "daily" || mode === "weekly") && <input className="wlv-input sdv-time" type="time" aria-label={w.at} value={time} onChange={(e) => setTime(e.target.value || "08:00")} />}
          {mode === "custom" && <input className="wlv-input sdv-custom" aria-label={w.customFrequency} value={custom} placeholder={hint} title={hint} spellCheck={false} aria-invalid={!isFrequency(custom)} onChange={(e) => setCustom(e.target.value)} />}
        </div>
        <span className={`sdv-next${"error" in parsed || tooOften ? " is-error" : ""}`}>{"error" in parsed ? w.notAFrequency : tooOften ? w.tooOftenShort : next ? w.firstRun(next) : ""}</span>
      </div>

      <div className="sdv-when">
        <span className="sdv-label">Telegram</span>
        <TelegramPick id="sdv-telegram" bots={bots} value={telegram} onChange={setTelegram} />
      </div>

      <div className="sdv-composer-foot">
        <label className="sdv-switch">
          <Switch on={catchUp} onChange={setCatchUp} label={w.catchUp} />
          <span>{w.catchUpLong}</span>
        </label>
        <span className="sdv-composer-actions">
          <button
            type="button"
            className="sdv-pill"
            onClick={() => {
              onOpen(false);
              setProblem(null);
            }}
          >
            {t.common.cancel}
          </button>
          <button type="submit" className="sdv-schedule" disabled={busy}>
            {busy ? w.scheduling : w.schedule}
          </button>
        </span>
      </div>
      {problem && <p className="sdv-problem">{problem}</p>}
    </form>
  );
}
