"use client";

import { memo, useState } from "react";
import type { Message as MessageT } from "@/lib/domain/types";
import type { PlanEntry } from "@/lib/agent/events";
import { compactLabel } from "@/lib/agent/compact";
import { isStopped } from "@/lib/agent/stop";
import { Markdown } from "./markdown";
import { ChevronDown, Spinner } from "@/components/ui/icons";
import { ToolStepView } from "./tool-step";
import { useMessages } from "@/lib/i18n/react";

type Props = {
  message: MessageT;
  /** Who answers: the agent's name, over its replies. */
  author?: string;
  streaming: boolean;
  onRetry?: () => void;
  onAnswer?: (callId: string, allow: boolean, always?: boolean) => void;
  /** The address of a workspace file (tool images). */
  fileUrl?: (rel: string) => string;
};

/* ---------------------------------------------------------------------------
   A message in the thread.

   Yours is a tile set to the right: you are the one speaking, the shape
   says so. The agent's has no bubble — it is written straight on the page,
   as an answer and not as a sticky note — under a line that says who
   answers and, in mono and set back, the model that produced it: that is
   information, not decoration, and we look for it as soon as a reply
   surprises us.
--------------------------------------------------------------------------- */
export const Message = memo(function Message({ message, author, streaming, onRetry, onAnswer, fileUrl }: Props) {
  const m = useMessages();
  if (message.role === "user") {
    const joints = message.attachments ?? [];
    return (
      <article className="msg msg-user">
        {joints.length > 0 && (
          <div className="msg-joints">
            {joints.map((a) => (
              <span key={a.path} className="msg-joint" title={a.path}>
                {a.dataUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={a.dataUrl} alt={a.name} />
                ) : (
                  <span className="msg-joint-name mono">{a.name}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="msg-bubble">
          {message.research && <span className="msg-research">{m.chat.deepResearch}</span>}
          {message.content}
        </div>
      </article>
    );
  }

  /* The compaction in progress: a status line, never the summary being
     written. Without a stream (page reloaded midway), nothing — the next
     turn removes this message. */
  if (message.compacting) {
    if (!streaming) return null;
    return (
      <div className="msg-compacting" role="status">
        <Spinner />
        <span>
          {m.chat.compacting}
          <small>{m.chat.compactingHint}</small>
        </span>
      </div>
    );
  }

  if (message.compaction) return <CompactionView message={message} />;

  const steps = message.steps ?? [];
  const empty = message.content.length === 0 && steps.length === 0;
  const lastIsText = steps.length > 0 && steps[steps.length - 1].type === "text";
  return (
    <article className={`msg msg-agent${streaming && (steps.length === 0 || lastIsText) ? " is-streaming" : ""}`}>
      {(author || message.modelId) && (
        <header className="msg-head">
          {author && <span className="msg-author">{author}</span>}
          {message.modelId && (
            <span className="msg-model mono">
              {/* The model as its vendor names it: `grok/grok-4.7`, not the
                  internal `acp:` of a subscription agent (user request). */}
              {message.modelId.replace(/^acp:/, "")}
              {message.effort ? ` · ${message.effort}` : ""}
            </span>
          )}
        </header>
      )}
      {empty && streaming ? (
        <div className="msg-wait" aria-label={m.chat.agentWriting}>
          <span />
          <span />
          <span />
        </div>
      ) : empty && message.command && !message.error ? (
        /* One of the agent's own commands that answers nothing (`/rename`,
           `/goal clear`): it ran — not an empty reply. */
        <p className="msg-command-ran" role="status">
          {m.chat.commandRan(<code>{message.command}</code>)}
        </p>
      ) : steps.length > 0 ? (
        steps.map((s, i) =>
          s.type === "text" ? (
            <div className="md" key={i}>
              <Markdown text={s.text} />
            </div>
          ) : s.type === "thought" ? null : s.type === "plan" ? (
            <PlanView key={i} entries={s.entries} />
          ) : (
            <ToolStepView key={s.id} step={s} fileUrl={fileUrl} onAnswer={onAnswer ? (allow, always) => onAnswer(s.id, allow, always) : undefined} />
          ),
        )
      ) : (
        <div className="md">
          <Markdown text={message.content} />
        </div>
      )}
      {streaming && steps.length > 0 && !lastIsText && (
        <div className="msg-wait msg-wait-tools" aria-label={m.chat.agentWorking}>
          <span />
          <span />
          <span />
        </div>
      )}
      {/* Stopped by the user: a quiet mark, and the way to go on — the same
          resume as after a cut connection. */}
      {message.error && isStopped(message) ? (
        <div className="msg-stopped" role="status">
          <span>{m.chat.stopped}</span>
          {onRetry && (
            <button type="button" className="msg-stopped-go" onClick={onRetry}>
              {m.chat.continue}
            </button>
          )}
        </div>
      ) : message.error && (
        <div className="notice msg-error" role="alert">
          <p>{message.error}</p>
          {onRetry && (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              {m.chat.retry}
            </button>
          )}
        </div>
      )}
    </article>
  );
});

/* ---------------------------------------------------------------------------
   The compacted thread.

   Like Claude Code's "Compacted" line: a boundary, not a reply. The summary
   is there, folded — we open it to check what the agent retained, we do not
   read it on every pass.
--------------------------------------------------------------------------- */
const CompactionView = memo(function CompactionView({ message }: { message: MessageT }) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  return (
    <article className={`msg msg-compact${open ? " is-open" : ""}`}>
      <button type="button" className="msg-compact-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown className="thought-chevron" />
        {compactLabel(message)}
        <span className="msg-compact-hint">{open ? m.chat.hideSummary : m.chat.viewSummary}</span>
      </button>
      {open && (
        <div className="md">
          <Markdown text={message.content} />
        </div>
      )}
    </article>
  );
});

/* ---------------------------------------------------------------------------
   The plan the agent set itself. Read at a glance.

   The reasoning is NOT shown: it stays on the provider's side (`thought`
   steps are no longer produced; older threads that still hold some render
   nothing for them).
--------------------------------------------------------------------------- */

const PlanView = memo(function PlanView({ entries }: { entries: PlanEntry[] }) {
  const m = useMessages();
  const faits = entries.filter((e) => e.status === "completed").length;
  const share = entries.length > 0 ? (faits / entries.length) * 100 : 0;
  return (
    <div className="plan">
      <p className="plan-head">
        {m.chat.plan}
        <span className="plan-bar" aria-hidden="true">
          <i style={{ width: `${share}%` }} />
        </span>
        <span className="plan-count">{faits}/{entries.length}</span>
      </p>
      <ul>
        {entries.map((e, i) => (
          <li key={i} className={`plan-${e.status}`}>
            <span className="plan-mark" aria-hidden="true">
              {e.status === "completed" ? "✓" : e.status === "in_progress" ? "▸" : "·"}
            </span>
            {/* The text in its own span: a done step is struck through,
                its check mark is not. */}
            <span className="plan-text">{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

