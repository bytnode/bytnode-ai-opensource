/* ---------------------------------------------------------------------------
   Telegram, the channel the scheduled tasks' reports and the alerts can be
   sent to (user request, 2026-10-08).

   A bot is made by Telegram's own @BotFather (no app can create one): the
   user pastes its token here. Its chat with the user is found by itself —
   the user sends /start to the bot, `findChat` reads it from the bot's
   updates. Then `sendText` posts to that chat. The Bot API speaks HTTPS to
   api.telegram.org only; the token is part of the URL, so it is never
   logged, and an error never repeats it.

   The pure parts (token shape, cutting a long report, a short version) are
   tested; the calls are thin.
--------------------------------------------------------------------------- */

import type { TelegramBot } from "@/lib/domain/types";
import { chatOf, chunkMessage, isBotToken, telegramError, type Update } from "@/lib/telegram/text";

export type { TelegramBot };
export { chatOf, chunkMessage, isBotToken, MAX_MESSAGES, MESSAGE_LIMIT, shortReport, telegramError } from "@/lib/telegram/text";

const API = "https://api.telegram.org";

async function call<T>(token: string, method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!isBotToken(token)) throw new Error("This is not a bot token (it looks like 123456789:AA…, from @BotFather).");
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token.trim()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Telegram could not be reached (network).");
  }
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) throw new Error(telegramError(res.status, json.description));
  return json.result as T;
}

/** The bot's own name, to check a token. */
export async function botInfo(token: string): Promise<{ username: string; name: string }> {
  const me = await call<{ username?: string; first_name?: string }>(token, "getMe");
  return { username: me.username ?? "", name: me.first_name ?? me.username ?? "bot" };
}

/** The chat that wrote to the bot, or why there is none yet: no message
    received (the /start not sent — or sent to @BotFather), or the bot
    hands its messages to another service (a webhook: Telegram then
    refuses `getUpdates`). */
export async function findChat(token: string): Promise<{ chatId: string; chatName: string } | { chatId?: undefined; webhook?: string; received: number }> {
  const hook = await call<{ url?: string }>(token, "getWebhookInfo");
  if (hook.url) return { webhook: hook.url, received: 0 };
  const updates = await call<Update[]>(token, "getUpdates", { limit: 100 });
  return chatOf(updates) ?? { received: updates.length };
}

/** Sends a text, cut into as many messages as it needs. */
export async function sendText(bot: Pick<TelegramBot, "token" | "chatId">, text: string, signal?: AbortSignal): Promise<void> {
  for (const part of chunkMessage(text)) await call(bot.token, "sendMessage", { chat_id: bot.chatId, text: part, disable_web_page_preview: true }, signal);
}
