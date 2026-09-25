"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { ArrowDown } from "@/components/ui/icons";
import { Message } from "./message";

type Props = {
  settings: Settings;
  agent: AgentConfig;
  conversation: Conversation | null;
  streaming: boolean;
  onRetry: () => void;
  onAnswer: (callId: string, allow: boolean, always?: boolean) => void;
  /** Counts the user's sends: each one brings the thread back to the
      bottom, even when the reader had scrolled up. */
  follow: number;
};

/* ---------------------------------------------------------------------------
   The thread.

   Empty, it greets: the first name in large, light Geist. Full, it FOLLOWS
   what comes in — text, tool calls, lines from a Monitor — as long as the
   reader is at the bottom. As soon as they scroll up to read, we leave them
   be: no more automatic scrolling until they come back to the bottom on
   their own, or through the button that then appears.

   ⚠️ THE FOLLOWING WATCHES THE CONTENT HEIGHT, NOT THE TEXT. A tool call
   that shows up, a Monitor line, a block that unfolds change the height
   without changing the text: `ResizeObserver` is what sees them all.

   ⚠️ A PROGRAMMATIC SCROLL MUST NOT PASS FOR A GESTURE. Setting `scrollTop`
   fires `scroll` like a wheel notch; we mark it so the reader's position is
   only re-read on THEIR gestures.

   Sending a message is a way back to the bottom: the reader who had
   scrolled up to reread is brought down, smoothly, to where the
   conversation is — and pinned again. A smooth scroll fires `scroll` for
   its whole course: it stays marked until `scrollend` (or 900 ms), and the
   content that grows meanwhile (the message just sent, the reply) retargets
   it instead of cutting it with a jump.
--------------------------------------------------------------------------- */
export function Thread({ settings, agent, conversation, streaming, onRetry, onAnswer, follow }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const programmatic = useRef(false);
  const smoothing = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      programmatic.current = false;
    });
  };

  const readPosition = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinned.current = atBottom;
    setShowJump(!atBottom);
  };

  const onScroll = () => {
    if (programmatic.current || smoothing.current) return;
    readPosition();
  };

  /* A message sent: back down to the conversation, smoothly, pinned. */
  useEffect(() => {
    const el = scroller.current;
    if (!follow || !el) return;
    pinned.current = true;
    smoothing.current = true;
    const done = () => {
      window.clearTimeout(timer);
      el.removeEventListener("scrollend", done);
      smoothing.current = false;
      readPosition();
    };
    const timer = window.setTimeout(done, 900);
    el.addEventListener("scrollend", done);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    return done;
  }, [follow]);

  /* New thread: start again from the bottom, pinned. The component is
     remounted per conversation (key set by the parent), so the state starts
     from scratch. */
  useLayoutEffect(() => {
    pinned.current = true;
    toBottom();
  }, []);

  /* Anything that changes the content height carries the pinned reader along. */
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!pinned.current) return;
      const el = scroller.current;
      if (smoothing.current && el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!conversation || conversation.messages.length === 0) {
    const who = settings.profile.firstName.trim();
    const name = agent.name.trim() || "Your agent";
    return (
      <div className="thread thread-empty">
        <h1 className="hello">{who ? `Hello, ${who}.` : "Hello."}</h1>
        <p className="hello-sub">{name} is listening.</p>
      </div>
    );
  }

  const last = conversation.messages.length - 1;
  /* Images produced in the workspace are served by the server, for this
     agent. */
  const fileUrl = (rel: string) =>
    `/api/files?agentId=${encodeURIComponent(agent.id)}&workspace=${encodeURIComponent(agent.workspace ?? "")}&path=${encodeURIComponent(rel)}`;

  return (
    <div className="thread-wrap">
      <div className="thread" ref={scroller} onScroll={onScroll}>
        <div className="thread-inner" ref={inner}>
          {conversation.messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              author={agent.name.trim() || "Agent"}
              fileUrl={fileUrl}
              streaming={streaming && i === last}
              onRetry={i === last && m.error ? onRetry : undefined}
              onAnswer={i === last ? onAnswer : undefined}
            />
          ))}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="thread-jump"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            toBottom();
          }}
          aria-label="Jump to bottom"
        >
          <ArrowDown />
          {streaming ? "Follow the reply" : "Jump to bottom"}
        </button>
      )}
    </div>
  );
}
