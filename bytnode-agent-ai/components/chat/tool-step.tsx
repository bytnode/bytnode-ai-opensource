"use client";

import { useState } from "react";
import type { Step, SubagentState } from "@/lib/agent/events";
import { alwaysAsks, isAlwaysAskTitle, isExchangeTool, isWorkflowName, summarizeCall } from "@/lib/tools/names";
import { parseWorkflowReport } from "@/lib/tools/agents/subagent";
import { isProfessionId, professionInfo } from "@/lib/professions/catalog";
import { Markdown } from "./markdown";
import { isDangerous, ruleFor, ruleLabel } from "@/lib/tools/permissions";
import { pickAccount } from "@/lib/tools/exchange/accounts";
import { useSettings } from "@/lib/state/settings";
import { Check, ChevronDown, Close, Spinner } from "@/components/ui/icons";

type ToolStep = Extract<Step, { type: "tool" }>;

type Props = {
  step: ToolStep;
  onAnswer?: (allow: boolean, always?: boolean) => void;
  fileUrl?: (rel: string) => string;
};

/* ---------------------------------------------------------------------------
   Un appel d'outil dans le fil.

   Une ligne : le nom de l'outil, l'argument qui le resume, l'etat. Elle se
   deplie sur les arguments complets et la sortie, en mono. Quand l'accord
   est attendu, la ligne porte deux boutons et le reste attend.
--------------------------------------------------------------------------- */
export function ToolStepView({ step, onAnswer, fileUrl }: Props) {
  const [open, setOpen] = useState(false);
  const summary = summarizeCall(step.name, step.args);
  const pending = step.status === "pending";

  return (
    <div className={`ts ts-${step.status}${open ? " is-open" : ""}`}>
      <button type="button" className="ts-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ts-status" aria-hidden="true">
          {step.status === "running" ? <Spinner /> : step.status === "done" ? <Check /> : step.status === "pending" ? null : <Close />}
        </span>
        <span className="ts-name">{step.name}</span>
        {summary && <span className="ts-summary mono">{summary}</span>}
        <ChevronDown className="ts-chevron" />
      </button>

      {pending && onAnswer && <Ask step={step} onAnswer={onAnswer} />}

      {isWorkflowName(step.name) && <WorkflowView step={step} />}

      {step.lines && step.lines.length > 0 && (
        <pre className="ts-lines mono">{step.lines.join("\n")}</pre>
      )}

      {step.images && step.images.length > 0 && (
        <div className="ts-images">
          {step.images.map((im, i) => {
            const src = im.src.startsWith("file:") ? (fileUrl ? fileUrl(im.src.slice(5)) : null) : im.src;
            if (!src) return null;
            return (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="ts-image" title={im.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={im.name} loading="lazy" />
              </a>
            );
          })}
        </div>
      )}

      {open && (
        <div className="ts-detail">
          <pre className="ts-args mono">{JSON.stringify(step.args, null, 2)}</pre>
          {step.output !== undefined && <pre className="ts-output mono">{step.output}</pre>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Les sous-agents d'un Workflow.

   Une ligne par tache — son metier, son titre, son etat — qui se deplie
   sur le rapport rendu. Les lignes naissent des arguments de l'appel (on
   les voit pendant que l'accord est attendu), s'animent avec les
   evenements `subagent` (agents a cle), et, quand rien n'a ete emis en
   route (appel MCP d'un agent par abonnement), se lisent dans la sortie
   decoupee sur ses en-tetes.
--------------------------------------------------------------------------- */
type Row = { index: number; title: string; profession?: string; status: SubagentState["status"] | "pending"; report?: string };

function workflowRows(step: ToolStep): Row[] {
  const tasks = Array.isArray(step.args.tasks) ? (step.args.tasks as Array<Record<string, unknown> | null>) : [];
  const events = step.subagents ?? [];
  const settled = step.status === "done" || step.status === "failed";
  const parsed = events.length === 0 && settled && step.output ? parseWorkflowReport(step.output) : [];
  const fallback: Row["status"] = step.status === "pending" ? "pending" : step.status === "running" ? "running" : step.status === "done" ? "done" : "failed";
  const n = Math.max(tasks.length, events.length, parsed.length);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const t = tasks[i];
    const ev = events.find((e) => e.index === i);
    const p = parsed[i];
    const title = ev?.title ?? p?.title ?? (typeof t?.title === "string" && t.title.trim() ? t.title : `Tâche ${i + 1}`);
    const profession = ev?.profession ?? p?.profession ?? (typeof t?.profession === "string" ? t.profession : undefined);
    const status = ev?.status ?? (p ? (p.failed ? "failed" : "done") : fallback);
    rows.push({ index: i, title, profession, status, report: ev?.report ?? p?.body });
  }
  return rows;
}

function WorkflowView({ step }: { step: ToolStep }) {
  const rows = workflowRows(step);
  if (rows.length === 0) return null;
  return (
    <ul className="wf">
      {rows.map((r) => (
        <WorkflowRow key={r.index} row={r} />
      ))}
    </ul>
  );
}

function WorkflowRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const label = isProfessionId(row.profession) ? professionInfo(row.profession).label : null;
  const canOpen = Boolean(row.report);
  return (
    <li className={`wf-row wf-${row.status}${open ? " is-open" : ""}`}>
      <button type="button" className="wf-head" onClick={() => setOpen(!open)} disabled={!canOpen} aria-expanded={canOpen ? open : undefined}>
        <span className="ts-status" aria-hidden="true">
          {row.status === "running" ? <Spinner /> : row.status === "done" ? <Check /> : row.status === "failed" ? <Close /> : null}
        </span>
        {label && <span className="wf-prof">{label}</span>}
        <span className="wf-title">{row.title}</span>
        {canOpen && <span className="wf-hint">{open ? "masquer le rapport" : "voir le rapport"}</span>}
      </button>
      {open && row.report && (
        <div className="wf-report md">
          <Markdown text={row.report} />
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------------
   La demande d'accord.

   ⚠️ « TOUJOURS » N'OUVRE PLUS TOUT. Il memorise une regle : cet outil, ou
   ce debut de commande (`git status …`). Le bouton le dit, pour qu'on sache
   ce qu'on accorde. Et une commande irreversible — effacement recursif,
   formatage, poussee forcee — n'a pas de « Toujours » du tout : elle
   redemandera a chaque fois.
--------------------------------------------------------------------------- */
function Ask({ step, onAnswer }: { step: ToolStep; onAnswer: (allow: boolean, always?: boolean) => void }) {
  const dangereux = isDangerous(step.name, step.args);
  /* Un ordre, une fermeture, un transfert : jamais de « Toujours ». */
  const fonds = alwaysAsks(step.name) || isAlwaysAskTitle(step.name);
  const rule = dangereux || fonds ? null : ruleFor(step.name, step.args);
  return (
    <div className={`ts-ask${dangereux || fonds ? " is-danger" : ""}`}>
      <span className="ts-ask-text">
        {(isExchangeTool(step.name) || fonds) && <ExchangeBadge account={typeof step.args.account === "string" ? step.args.account : undefined} />}
        {fonds
          ? "Cette action engage des fonds. À autoriser une fois, en connaissance de cause."
          : dangereux
            ? "Cette commande est irréversible. À autoriser une fois, en connaissance de cause."
            : "L’agent veut exécuter cet outil."}
      </span>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => onAnswer(true)}>
        Autoriser
      </button>
      {rule && (
        <button type="button" className="btn btn-sm" onClick={() => onAnswer(true, true)} title={`Cet accord sera mémorisé pour cet agent : ${rule}`}>
          {ruleLabel(rule)}
        </button>
      )}
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAnswer(false)}>
        Refuser
      </button>
    </div>
  );
}

/** RÉEL ou TESTNET, d'apres le compte vise. Un compte ambigu (plusieurs
    comptes, aucun nomme) vaut RÉEL : on se trompe du cote prudent. */
export function ExchangeBadge({ account }: { account?: string }) {
  const { settings } = useSettings();
  const picked = pickAccount(settings.keys.exchanges, account);
  const live = !("account" in picked) || !picked.account.testnet;
  return <span className={`xch-badge${live ? " is-live" : ""}`}>{live ? "RÉEL" : "TESTNET"}</span>;
}
