"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { ArrowDown } from "@/components/ui/icons";
import { Message } from "./message";
import { saveConversation } from "@/lib/state/conversations";
import { markdownPrefix, useTypewriter } from "@/lib/ui/typewriter";
import { useMessages } from "@/lib/i18n/react";

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
  const m = useMessages();
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const programmatic = useRef(false);
  const smoothing = useRef(false);
  const [showJump, setShowJump] = useState(false);

  /* The first launch's welcome (2026-10-09: « un premier welcome, un
     scrolling automatique, puis du texte qui se génère »): a greeting in
     large, then — after a breath — the agent's message written word by
     word, the thread gliding down with it. Played once: the flag goes when
     it is written out, and the greeting stays for this visit only. */
  const intro = conversation && conversation.messages.length === 1 && conversation.messages[0].intro ? conversation.messages[0] : null;
  const [greeted] = useState(() => intro !== null);
  /* The greeting takes its time to arrive; then the text comes letter by
     letter, fluid rather than word blocks (2026-10-09: « plus rapide … plus
     fluide, pas petit bloc après petit bloc »), its Markdown kept whole. */
  const typed = useTypewriter(intro?.content ?? "", { enabled: intro !== null, cps: 115, delay: 3400 });
  const playing = intro !== null && !typed.done;
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  });
  useEffect(() => {
    if (intro && typed.done && conversation) saveConversation({ ...conversation, messages: [{ ...intro, intro: undefined }] });
  }, [intro, typed.done, conversation]);
  /* Following it: not a smooth scroll restarted at every letter (it
     stuttered), an easing glide toward the bottom, every frame, as long
     as the reader stays pinned. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const glide = () => {
      const el = scroller.current;
      if (el && pinned.current) {
        const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
        if (gap > 0.5) el.scrollTop += Math.max(0.5, gap * 0.08);
      }
      raf = requestAnimationFrame(glide);
    };
    raf = requestAnimationFrame(glide);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

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
    /* While the welcome writes itself, the thread glides down with smooth
       scrolls: their own `scroll` events read « not at the bottom » mid-way
       and unpinned it — the reader had to scroll down by hand. Only a
       gesture up (`onWheel`) lets go then. */
    if (programmatic.current || smoothing.current || playingRef.current) return;
    readPosition();
  };

  const onWheel = (e: { deltaY: number }) => {
    if (playingRef.current && e.deltaY < 0) {
      pinned.current = false;
      setShowJump(true);
    }
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

  /* Anything that changes the content height carries the pinned reader
     along — and so does the thread's own height: the composer grows when
     its command list opens, and the last lines move up above it instead of
     being covered. */
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!pinned.current) return;
      const el = scroller.current;
      /* The welcome glides on its own (above). */
      if (playingRef.current) return;
      if (smoothing.current && el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else toBottom();
    });
    ro.observe(el);
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);

  if (!conversation || conversation.messages.length === 0) {
    const who = settings.profile.firstName.trim();
    const name = agent.name.trim() || m.chat.yourAgent;
    return (
      <div className="thread thread-empty">
        <h1 className="hello">{who ? m.chat.hello(who) : m.chat.helloAnon}</h1>
        <p className="hello-sub">{m.chat.listening(name)}</p>
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
      <div className="thread" ref={scroller} onScroll={onScroll} onWheel={onWheel}>
        <div className="thread-inner" ref={inner}>
          {greeted && (
            <div className="intro-hello">
              <h1 className="hello">{settings.profile.firstName.trim() ? m.chat.welcome(settings.profile.firstName.trim()) : m.chat.welcomeAnon}</h1>
              <p className="hello-sub">{m.chat.welcomeSub}</p>
            </div>
          )}
          {conversation.messages.map((msg, i) => (
            <Message
              key={msg.id}
              message={playing && msg.id === intro?.id ? { ...msg, content: markdownPrefix(msg.content, typed.shown.length) } : msg}
              author={agent.name.trim() || m.chat.agent}
              fileUrl={fileUrl}
              streaming={(streaming && i === last) || (playing && msg.id === intro?.id)}
              onRetry={i === last && msg.error ? onRetry : undefined}
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
          aria-label={m.chat.jumpToBottom}
        >
          <ArrowDown />
          {streaming ? m.chat.followReply : m.chat.jumpToBottom}
        </button>
      )}
    </div>
  );
}
