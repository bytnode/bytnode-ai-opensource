import type { TelegramBot } from "@/lib/domain/types";
import { sendText } from "@/lib/server/telegram";
import type { Session } from "../core/contract";

/* ---------------------------------------------------------------------------
   Sending to one of the user's Telegram bots, for any plugin (the scheduled
   tasks' reports, the alerts). A plugin keeps only the bot's ID; its token
   and chat come from the live session (`Session.telegramBots`, the
   settings), so a bot renamed or given a new token keeps working, and a
   bot removed says so instead of failing silently.
--------------------------------------------------------------------------- */

/** The bot named by an id or a name, ready to send (token and chat). */
export function findBot(bots: TelegramBot[] | undefined, ref: string): TelegramBot | undefined {
  const r = ref.trim().toLowerCase();
  return (bots ?? []).find((b) => b.id === ref.trim()) ?? (bots ?? []).find((b) => b.name.trim().toLowerCase() === r);
}

/** Sends `text` to the bot `botId`: nothing to do without one; an error
    message (to notify) when it cannot be sent. */
export async function sendToBot(session: Pick<Session, "telegramBots"> | null, botId: string | undefined, text: string): Promise<{ sent: boolean; error?: string }> {
  if (!botId) return { sent: false };
  const bot = findBot(session?.telegramBots, botId);
  if (!bot) return { sent: false, error: "This Telegram bot is no longer in Settings → Authentication." };
  if (!bot.token || !bot.chatId) return { sent: false, error: `The Telegram bot "${bot.name}" is not ready: give it its token and detect its chat (Settings → Authentication).` };
  try {
    await sendText(bot, text);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
