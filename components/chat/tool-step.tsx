"use client";

import { useState } from "react";
import type { Step } from "@/lib/agent/events";
import { summarizeCall } from "@/lib/tools/names";
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

      {pending && onAnswer && (
        <div className="ts-ask">
          <span className="ts-ask-text">L&apos;agent veut exécuter cet outil.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onAnswer(true)}>
            Autoriser
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onAnswer(true, true)}>
            Toujours pour cet agent
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAnswer(false)}>
            Refuser
          </button>
        </div>
      )}

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
