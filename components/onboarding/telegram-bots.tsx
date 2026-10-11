"use client";

import { useEffect, useState } from "react";
import type { TelegramBot } from "@/lib/domain/types";
import { isBotToken } from "@/lib/telegram/text";
import { Field } from "@/components/ui/field";
import { Check, Spinner } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";
import { currentMessages } from "@/lib/i18n/store";
import { SecretInput } from "./exchange-accounts";

/* ---------------------------------------------------------------------------
   The Telegram bots (user request, 2026-10-08): where a scheduled task's
   report or an alert can also be sent — each task and each alert picks its
   bot. Several bots, each with its own name ("Trading alerts", "Morning
   briefs"…).

   No app can create a Telegram bot: @BotFather does, and gives a token.
   The form walks through it — open @BotFather, paste the token (checked
   with Telegram: the bot's name comes back), send /start to the bot, and
   its chat is found by itself (`/api/telegram`). "Test" sends a first
   message. The token is a secret: the system's vault in the desktop app.
--------------------------------------------------------------------------- */

type Props = {
  value: TelegramBot[];
  onChange: (bots: TelegramBot[]) => void;
  /** The first launch's setup: the form already open while there is no bot
      (2026-10-09). */
  startOpen?: boolean;
  /** The setup's way on, beside « Add », on the right: « Skip », « Skip and
      start » (2026-10-09). */
  aside?: { label: string; onClick: () => void };
};

type Answer = { ok: boolean; message?: string; username?: string; name?: string; chatId?: string; chatName?: string; webhook?: string; received?: number };

/** How long the form keeps looking for the /start, and how often. */
const WATCH_MS = 3 * 60_000;
const EVERY_MS = 3000;

async function ask(body: Record<string, string>): Promise<Answer> {
  try {
    const res = await fetch("/api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as Answer;
  } catch {
    return { ok: false, message: currentMessages().onboarding.serverUnreachable };
  }
}

export function TelegramBots({ value, onChange, startOpen = false, aside }: Props) {
  const t = useMessages().onboarding.telegram;
  const [adding, setAdding] = useState(startOpen && value.length === 0);
  return (
    <div className="xch">
      <div className="xch-head">
        <span className="field-label">{t.title}</span>
        <span className="field-hint">{t.hint}</span>
      </div>
      {value.length > 0 && (
        <ul className="xch-list">
          {value.map((b) => (
            <BotRow key={b.id} bot={b} onRemove={() => onChange(value.filter((x) => x.id !== b.id))} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddBot
          existing={value}
          aside={aside}
          onCancel={startOpen && value.length === 0 ? undefined : () => setAdding(false)}
          onAdd={(b) => {
            onChange([...value, b]);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
          {t.addBot}
        </button>
      )}
    </div>
  );
}

function BotRow({ bot, onRemove }: { bot: TelegramBot; onRemove: () => void }) {
  const m = useMessages();
  const t = m.onboarding.telegram;
  const [test, setTest] = useState<{ state: "idle" | "sending" } | { state: "ok" } | { state: "bad"; message: string }>({ state: "idle" });
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="xch-row">
      <span className="xch-label">{bot.name}</span>
      <span className="xch-exchange">{bot.chatName ? `→ ${bot.chatName}` : t.noChat}</span>
      <span className="xch-status">
        {test.state === "ok" && <span className="xch-ok">{t.sent}</span>}
        {test.state === "bad" && <span className="xch-bad">{test.message}</span>}
      </span>
      <button
        type="button"
        className={`btn btn-sm${test.state === "ok" ? " is-ok" : ""}`}
        disabled={test.state === "sending"}
        onClick={async () => {
          setTest({ state: "sending" });
          const r = await ask({ action: "test", token: bot.token, chatId: bot.chatId });
          setTest(r.ok ? { state: "ok" } : { state: "bad", message: r.message ?? t.notSent });
        }}
      >
        {test.state === "sending" ? <Spinner /> : test.state === "ok" ? <Check /> : null}
        {m.onboarding.test}
      </button>
      {confirm ? (
        <>
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
            {m.common.delete}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
            {m.onboarding.keep}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
          {m.common.remove}
        </button>
      )}
    </li>
  );
}

/** `onCancel` absent: the form is the step itself (the setup's first
    bot), nothing to cancel back to. */
function AddBot({ existing, onAdd, onCancel, aside }: { existing: TelegramBot[]; onAdd: (b: TelegramBot) => void; onCancel?: () => void; aside?: { label: string; onClick: () => void } }) {
  const m = useMessages();
  const t = m.onboarding.telegram;
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [bot, setBot] = useState<{ username: string; name: string } | null>(null);
  const [chat, setChat] = useState<{ chatId: string; chatName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* A bot that hands its messages to another service (webhook): Telegram
     will not give them to us. */
  const [webhook, setWebhook] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  /* The token checked, no chat yet: the form watches for the /start by
     itself (user report, 2026-10-08: the /start was sent, nothing
     happened — the old « Find the chat » said nothing when it found none). */
  useEffect(() => {
    if (!bot || chat || webhook) return;
    let stop = false;
    const tick = setInterval(async () => {
      const r = await ask({ action: "check", token });
      if (stop || !r.ok) return;
      if (r.chatId) setChat({ chatId: r.chatId, chatName: r.chatName ?? r.chatId });
      else if (r.webhook) setWebhook(r.webhook);
    }, EVERY_MS);
    const end = setTimeout(() => {
      clearInterval(tick);
      setGaveUp(true);
    }, WATCH_MS);
    return () => {
      stop = true;
      clearInterval(tick);
      clearTimeout(end);
    };
  }, [bot, chat, webhook, token]);

  const check = async () => {
    setBusy(true);
    setProblem(null);
    const r = await ask({ action: "check", token });
    setBusy(false);
    if (!r.ok) {
      setBot(null);
      setChat(null);
      setProblem(r.message ?? t.tokenRefused);
      return;
    }
    setBot({ username: r.username ?? "", name: r.name ?? "" });
    setChat(r.chatId ? { chatId: r.chatId, chatName: r.chatName ?? r.chatId } : null);
    setWebhook(r.webhook ?? null);
    setGaveUp(false);
  };

  const label = name.trim() || bot?.name || "Telegram";
  const duplicate = existing.some((b) => b.name.trim().toLowerCase() === label.toLowerCase());
  /* What is missing, said when Add is pressed. */
  const why = !isBotToken(token) ? t.whyToken : !bot ? t.whyCheck : !chat ? t.whyStart(bot.username) : duplicate ? t.whyDuplicate : null;

  return (
    <div className="xch-form">
      <ol className="tg-steps">
        <li>
          {t.step1(
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
              @BotFather
            </a>,
            <span className="mono">/newbot</span>,
          )}
        </li>
        <li>{t.step2}</li>
        <li>{t.step3(<span className="mono">/start</span>)}</li>
      </ol>
      <Field id="tg-name" label={t.nameLabel} hint={t.nameHint} error={duplicate ? t.duplicate : undefined}>
        <input id="tg-name" className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={bot?.name || t.namePlaceholder} />
      </Field>
      <Field id="tg-token" label={t.tokenLabel} hint={bot ? `✓ @${bot.username}` : t.tokenHint}>
        <div className="tg-token">
          <SecretInput
            id="tg-token"
            value={token}
            onChange={(t) => {
              setToken(t);
              setBot(null);
              setChat(null);
              setWebhook(null);
            }}
          />
          <button type="button" className={`btn btn-sm${bot ? " is-ok" : ""}`} disabled={!isBotToken(token) || busy} onClick={() => void check()}>
            {busy && !bot ? <Spinner /> : bot ? <Check /> : null}
            {bot ? t.checked : t.check}
          </button>
        </div>
      </Field>
      {bot && (
        <div className="tg-chat">
          {chat ? (
            <span className="xch-ok">{t.chatFound(chat.chatName)}</span>
          ) : webhook ? (
            <span className="xch-bad">{t.webhook(bot.username, hostOf(webhook) ?? t.anotherServer)}</span>
          ) : (
            <>
              <span>
                {t.openBot(
                  <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer">
                    @{bot.username}
                  </a>,
                  <span className="mono">/start</span>,
                )}
              </span>
              {gaveUp ? (
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void check()}>
                  {busy ? <Spinner /> : null}
                  {t.lookAgain}
                </button>
              ) : (
                <span className="tg-waiting">
                  <Spinner /> {t.waiting}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {problem && <p className="field-error">{problem}</p>}
      <div className="xch-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => (why || !chat ? setProblem(why ?? t.whyCheck) : onAdd({ id: crypto.randomUUID().slice(0, 8), name: label, token: token.trim(), chatId: chat.chatId, chatName: chat.chatName }))}
        >
          {m.common.add}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {m.common.cancel}
          </button>
        )}
        {aside && (
          <button type="button" className="btn btn-sm btn-ghost xch-aside" onClick={aside.onClick}>
            {aside.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** A webhook's host, to say where the bot's messages go; null when the
    address cannot be read (the caller says « another server »). */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
