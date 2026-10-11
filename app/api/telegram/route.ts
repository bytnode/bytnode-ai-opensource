import { botInfo, findChat, sendText } from "@/lib/server/telegram";

/* ---------------------------------------------------------------------------
   The Telegram bot form's three steps (Settings → Authentication):
   - `check` {token}: the bot's name (the token is good), and its chat if
     the user already sent it /start;
   - `test` {token, chatId}: a first message, to see it arrive.
   Always 200 with `{ ok, … }` or `{ ok: false, message }`; the token is in
   the body, never logged, never repeated.
--------------------------------------------------------------------------- */

export async function POST(req: Request) {
  let body: { action?: unknown; token?: unknown; chatId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, message: "Unreadable request body." }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  try {
    if (body.action === "check") {
      const bot = await botInfo(token);
      return Response.json({ ok: true, username: bot.username, name: bot.name, ...(await findChat(token)) });
    }
    if (body.action === "test") {
      const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
      if (!chatId) return Response.json({ ok: false, message: "No chat yet: send /start to the bot, then detect the chat." });
      await sendText({ token, chatId }, "✅ BytNode-AI is connected. Your scheduled tasks and alerts can now be sent here.");
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
}
