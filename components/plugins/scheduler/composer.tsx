"use client";

import { useState } from "react";
import type { AgentConfig } from "@/lib/domain/types";
import { isFrequency, nextRun, parseFrequency } from "@/lib/plugins/core/frequency";
import { relative } from "@/lib/plugins/scheduler/timeline";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/* ---------------------------------------------------------------------------
   "Schedule a task", at the top of the tab: what the task is called, which
   agent runs it, what it must do, and when — chosen, not typed: every few
   hours, every day at a time, every week on a day at a time, or a custom
   frequency for who knows the grammar. The next run is said before the
   task exists. One blue button schedules it.
--------------------------------------------------------------------------- */

type Mode = "hours" | "daily" | "weekly" | "custom";

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "hours", label: "Every few hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];
const HOURS = ["1", "2", "4", "6", "12"].map((h) => ({ value: h, label: h === "1" ? "Every hour" : `${h} h` }));
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => ({ value: d, label: d.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) }));
const HINT = "every 30 minutes · every 4 hours · daily at 08:00 · every monday at 09:30";

type Props = {
  agents: AgentConfig[];
  /** The server's now, for the next run's preview. */
  now: number | null;
  /** Schedules the task; answers why not, or null. */
  onCreate: (task: { title: string; agent: string; frequency: string; prompt: string; catchUp: "run-once-on-start" | "skip" }) => Promise<string | null>;
};

export function Composer({ agents, now, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState(agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("daily");
  const [hours, setHours] = useState("4");
  const [time, setTime] = useState("08:00");
  const [day, setDay] = useState("monday");
  const [custom, setCustom] = useState("every 30 minutes");
  const [catchUp, setCatchUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const frequency = mode === "hours" ? (hours === "1" ? "every hour" : `every ${hours} hours`) : mode === "daily" ? `daily at ${time}` : mode === "weekly" ? `every ${day} at ${time}` : custom.trim();
  const parsed = parseFrequency(frequency);
  const next = now !== null && !("error" in parsed) ? relative(parsed.kind === "interval" ? now : nextRun(parsed, now), now) : null;
  const chosen = agents.find((a) => a.id === agent) ?? agents[0];
  const ready = title.trim() !== "" && prompt.trim() !== "" && Boolean(chosen) && isFrequency(frequency);

  const submit = async () => {
    if (!ready || busy || !chosen) return;
    setBusy(true);
    setDone(null);
    const p = await onCreate({ title: title.trim(), agent: chosen.id, frequency, prompt: prompt.trim(), catchUp: catchUp ? "run-once-on-start" : "skip" });
    setBusy(false);
    setProblem(p);
    if (p) return;
    setDone(`“${title.trim()}” is scheduled — ${next === "now" ? "its first run starts now" : `first run ${next}`}.`);
    setTitle("");
    setPrompt("");
  };

  return (
    <form
      className="sdv-composer"
      aria-label="Schedule a task"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="sdv-composer-top">
        <input className="sdv-title-input" aria-label="Task name" placeholder="Schedule a task — “Morning market brief”" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <div className="sdv-agent">
          <span className="sdv-label">Run by</span>
          {agents.length ? <Select id="sdv-agent" label="Agent" value={chosen?.id ?? ""} options={agents.map((a) => ({ value: a.id, label: a.name }))} onChange={setAgent} /> : <span className="sdv-none">Create an agent first</span>}
        </div>
      </div>

      <textarea
        className="wlv-input sdv-prompt"
        aria-label="What the agent must do"
        rows={3}
        placeholder="What the agent must do, as you would ask it: “Summarise the overnight moves of my watchlist, the funding rates and the events of the day. Sources and times for every figure.”"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="sdv-when">
        <span className="sdv-label">When</span>
        <Segmented label="Frequency" value={mode} options={MODES} onChange={setMode} />
        <div className="sdv-when-detail">
          {mode === "hours" && <Segmented label="Every" value={hours} options={HOURS} onChange={setHours} />}
          {mode === "weekly" && <Segmented label="Day" value={day} options={DAYS} onChange={setDay} />}
          {(mode === "daily" || mode === "weekly") && <input className="wlv-input sdv-time" type="time" aria-label="At" value={time} onChange={(e) => setTime(e.target.value || "08:00")} />}
          {mode === "custom" && <input className="wlv-input sdv-custom" aria-label="Custom frequency" value={custom} placeholder={HINT} title={HINT} spellCheck={false} aria-invalid={!isFrequency(custom)} onChange={(e) => setCustom(e.target.value)} />}
        </div>
        <span className={`sdv-next${"error" in parsed ? " is-error" : ""}`}>{"error" in parsed ? "Not a frequency the scheduler reads" : next ? `First run ${next}` : ""}</span>
      </div>

      <div className="sdv-composer-foot">
        <label className="sdv-switch">
          <Switch on={catchUp} onChange={setCatchUp} label="Catch up a missed run" />
          <span>Catch up a run missed while the app was closed</span>
        </label>
        <button type="submit" className="sdv-schedule" disabled={!ready || busy}>
          {busy ? "Scheduling…" : "Schedule"}
        </button>
      </div>
      {problem && <p className="sdv-problem">{problem}</p>}
      {done && !problem && <p className="sdv-done">{done}</p>}
    </form>
  );
}
