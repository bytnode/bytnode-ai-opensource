/* The pure side of Telegram (`lib/server/telegram.ts` makes the calls):
   a bot token's shape, a long report cut into messages, its short version,
   Telegram's errors said plainly, the chat found in the bot's updates.
   Safe in the browser too (the scheduler's view reads the task model). */

/** Telegram refuses a message above 4096 characters; a margin for safety. */
export const MESSAGE_LIMIT = 4000;
/** A report longer than this many messages is cut (a flood helps nobody). */
export const MAX_MESSAGES = 6;

/** `123456789:AA…` — the shape @BotFather gives. Pure. */
export const isBotToken = (token: string) => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());

/** A text cut into Telegram-sized messages, on paragraph then line then
    space boundaries; past `max` messages, the rest is dropped and said so.
    Pure. */
export function chunkMessage(text: string, limit = MESSAGE_LIMIT, max = MAX_MESSAGES): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > 0 && out.length < max) {
    if (rest.length <= limit) {
      out.push(rest);
      rest = "";
      break;
    }
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > limit * 0.5 ? cut : limit;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest.length > 0) out[out.length - 1] = `${out[out.length - 1].slice(0, limit - 60).trimEnd()}\n\n[… the rest is in BytNode-AI]`;
  return out;
}

/** The short version of a report: its first paragraphs, up to `max`
    characters, ended on a sentence or a line. Pure. */
export function shortReport(text: string, max = 700): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
  return `${(cut > max * 0.4 ? window.slice(0, cut + 1) : window).trimEnd()}\n\n[Full report in BytNode-AI]`;
}

/** A Telegram error said plainly, never with the token. Pure. */
export function telegramError(status: number, description: string | undefined): string {
  if (status === 401 || status === 404) return "Telegram refused this bot token: copy it again from @BotFather.";
  if (status === 403) return "The bot cannot write to this chat: open the bot in Telegram and send it /start.";
  if (status === 400 && /chat not found/i.test(description ?? "")) return "Chat not found: send /start to the bot in Telegram, then detect the chat again.";
  if (status === 429) return "Telegram asks to slow down: try again in a minute.";
  return `Telegram answered ${status}${description ? `: ${description}` : ""}.`;
}

type Chat = { id: number; type?: string; title?: string; first_name?: string; last_name?: string; username?: string };

/** What the bot received: a message (the user's /start), a post in a
    channel it was added to, or being added to a chat. */
export type Update = { message?: { chat?: Chat }; channel_post?: { chat?: Chat }; my_chat_member?: { chat?: Chat } };

/** The chat that last wrote to the bot (the user's /start). Pure. */
export function chatOf(updates: Update[]): { chatId: string; chatName: string } | null {
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i];
    const c = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
    if (c && typeof c.id === "number") {
      const name = c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(" ") || (c.username ? `@${c.username}` : String(c.id)));
      return { chatId: String(c.id), chatName: name };
    }
  }
  return null;
}
