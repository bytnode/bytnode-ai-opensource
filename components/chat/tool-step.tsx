"use client";

import { useState } from "react";
import type { Step, SubagentState } from "@/lib/agent/events";
import { alwaysAsks, isAlwaysAskTitle, isExchangeTool, isOpenViewName, isPaperTool, isWorkflowName, summarizeCall } from "@/lib/tools/names";
import { parseWorkflowReport } from "@/lib/tools/agents/subagent";
import { isProfessionId, professionInfo } from "@/lib/professions/catalog";
import { Markdown } from "./markdown";
import { isDangerous, ruleFor, ruleLabel } from "@/lib/tools/permissions";
import { pickAccount } from "@/lib/tools/exchange/accounts";
import { useSettings } from "@/lib/state/settings";
import { Check, ChevronDown, Close, Spinner } from "@/components/ui/icons";
import { Badge, OpenViewCard, ToolCardView } from "@/components/plugins/cards";

type ToolStep = Extract<Step, { type: "tool" }>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Props = {
  step: ToolStep;
  onAnswer?: (allow: boolean, always?: boolean) => void;
  fileUrl?: (rel: string) => string;
};

/* ---------------------------------------------------------------------------
   A tool call in the thread.

   One row: the tool's name, the argument that summarises it, the status. It
   unfolds onto the full arguments and the output, in mono. When permission
   is awaited, the row carries two buttons and the rest waits.
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
        {isPaperTool(step.name) && <Badge badge="PAPER" />}
        <span className="ts-name">{step.name}</span>
        {summary && <span className="ts-summary mono">{summary}</span>}
        <ChevronDown className="ts-chevron" />
      </button>

      {pending && onAnswer && <Ask step={step} onAnswer={onAnswer} />}

      {step.card && <ToolCardView card={step.card} fileUrl={fileUrl} />}

      {isOpenViewName(step.name) && step.status === "done" && typeof step.args.view === "string" && (
        <OpenViewCard view={step.args.view} params={isRecord(step.args.params) ? step.args.params : undefined} />
      )}

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
   The sub-agents of a Workflow.

   One row per task — its profession, its title, its status — that unfolds
   onto the returned report. The rows are born from the call's arguments
   (they are visible while permission is awaited), come alive with the
   `subagent` events (key agents), and, when nothing was emitted along the
   way (MCP call from a subscription agent), are read from the output split
   on its headings.
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
    const title = ev?.title ?? p?.title ?? (typeof t?.title === "string" && t.title.trim() ? t.title : `Task ${i + 1}`);
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
        {canOpen && <span className="wf-hint">{open ? "hide the report" : "view the report"}</span>}
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
   The permission prompt.

   ⚠️ "ALWAYS" NO LONGER OPENS EVERYTHING. It memorises a rule: this tool,
   or this start of command (`git status …`). The button says so, so we know
   what we are granting. And an irreversible command — recursive deletion,
   formatting, force-push — has no "Always" at all: it will ask again every
   time.
--------------------------------------------------------------------------- */
function Ask({ step, onAnswer }: { step: ToolStep; onAnswer: (allow: boolean, always?: boolean) => void }) {
  const dangereux = isDangerous(step.name, step.args);
  /* An order, a close, a transfer — or any tool whose policy always asks:
     never an "Always". */
  const fonds = step.alwaysAsk === true || alwaysAsks(step.name) || isAlwaysAskTitle(step.name);
  const rule = dangereux || fonds ? null : ruleFor(step.name, step.args);
  return (
    <div className={`ts-ask${dangereux || fonds ? " is-danger" : ""}`}>
      <span className="ts-ask-text">
        {(isExchangeTool(step.name) || fonds) && <ExchangeBadge account={typeof step.args.account === "string" ? step.args.account : undefined} />}
        {fonds
          ? "This action commits funds. Allow it once, knowingly."
          : dangereux
            ? "This command is irreversible. Allow it once, knowingly."
            : "The agent wants to run this tool."}
      </span>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => onAnswer(true)}>
        Allow
      </button>
      {rule && (
        <button type="button" className="btn btn-sm" onClick={() => onAnswer(true, true)} title={`This permission will be remembered for this agent: ${rule}`}>
          {ruleLabel(rule)}
        </button>
      )}
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAnswer(false)}>
        Deny
      </button>
    </div>
  );
}

/** LIVE or TESTNET, from the targeted account. An ambiguous account (several
    accounts, none named) counts as LIVE: we err on the cautious side. */
export function ExchangeBadge({ account }: { account?: string }) {
  const { settings } = useSettings();
  const picked = pickAccount(settings.keys.exchanges, account);
  const live = !("account" in picked) || !picked.account.testnet;
  return <span className={`xch-badge${live ? " is-live" : ""}`}>{live ? "LIVE" : "TESTNET"}</span>;
}
