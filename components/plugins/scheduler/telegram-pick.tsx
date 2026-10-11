"use client";

import type { TelegramBot } from "@/lib/domain/types";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { useMessages } from "@/lib/i18n/react";

/* ---------------------------------------------------------------------------
   Where a task's report is also sent (user request, 2026-10-08): one of the
   user's Telegram bots, or none — and, when one is chosen, the whole report
   or its start. Used by the new-task form and by a task's unfolded row.
   No bot yet: the way to add one.
--------------------------------------------------------------------------- */

export type TelegramChoice = { bot: string; report: "full" | "short" };

export function TelegramPick({ id, bots, value, onChange, disabled = false }: { id: string; bots: TelegramBot[]; value: TelegramChoice; onChange: (v: TelegramChoice) => void; disabled?: boolean }) {
  const w = useMessages().scheduler.telegram;
  const reports: Array<{ value: "full" | "short"; label: string }> = [
    { value: "full", label: w.fullReport },
    { value: "short", label: w.short },
  ];
  if (bots.length === 0) return <span className="sdv-hint">{w.noBot}</span>;
  /* A bot removed from the settings still shows, said as such. */
  const known = !value.bot || bots.some((b) => b.id === value.bot);
  const options = [{ value: "", label: w.dontSend }, ...bots.map((b) => ({ value: b.id, label: b.name })), ...(known ? [] : [{ value: value.bot, label: w.removedBot }])];
  return (
    <span className={`sdv-telegram${disabled ? " is-busy" : ""}`}>
      <Select id={id} label={w.bot} value={value.bot} options={options} onChange={(bot) => onChange({ ...value, bot })} />
      {value.bot && <Segmented label={w.report} value={value.report} options={reports} onChange={(report) => onChange({ ...value, report })} />}
    </span>
  );
}
