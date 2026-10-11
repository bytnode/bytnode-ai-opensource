import { describe, expect, test } from "vitest";
import { chatOf, chunkMessage, isBotToken, shortReport, telegramError } from "./telegram";

describe("Telegram", () => {
  test("recognises a bot token", () => {
    expect(isBotToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0")).toBe(true);
    expect(isBotToken(" 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0 ")).toBe(true);
    expect(isBotToken("sk-or-v1-abc")).toBe(false);
    expect(isBotToken("123:short")).toBe(false);
  });
  test("cuts a long report on boundaries, never above the limit", () => {
    const para = "word ".repeat(150).trim();
    const text = Array.from({ length: 12 }, () => para).join("\n\n");
    const parts = chunkMessage(text, 1000, 20);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
  test("drops what is past the last message, and says so", () => {
    const parts = chunkMessage("x ".repeat(5000), 1000, 2);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatch(/the rest is in BytNode-AI\]$/);
    expect(parts[1].length).toBeLessThanOrEqual(1000);
  });
  test("a short text is one message", () => {
    expect(chunkMessage("  hello  ")).toEqual(["hello"]);
    expect(chunkMessage("")).toEqual([]);
  });
  test("the short report keeps the first sentences", () => {
    expect(shortReport("Short.")).toBe("Short.");
    const r = shortReport("First point is done. " + "More detail here. ".repeat(80), 200);
    expect(r.length).toBeLessThan(260);
    expect(r).toMatch(/\[Full report in BytNode-AI\]$/);
  });
  test("finds the chat that wrote to the bot last", () => {
    expect(chatOf([])).toBeNull();
    expect(chatOf([{ message: { chat: { id: 1, first_name: "Old" } } }, { message: { chat: { id: 42, first_name: "Ben", last_name: "F" } } }])).toEqual({ chatId: "42", chatName: "Ben F" });
    expect(chatOf([{ message: { chat: { id: -100, title: "Trading desk" } } }])).toEqual({ chatId: "-100", chatName: "Trading desk" });
    expect(chatOf([{ channel_post: { chat: { id: -200, title: "Signals" } } }])).toEqual({ chatId: "-200", chatName: "Signals" });
    expect(chatOf([{ my_chat_member: { chat: { id: -300, title: "Group" } } }])).toEqual({ chatId: "-300", chatName: "Group" });
  });
  test("says Telegram's errors plainly", () => {
    expect(telegramError(401, "Unauthorized")).toMatch(/token/);
    expect(telegramError(403, "bot was blocked")).toMatch(/\/start/);
    expect(telegramError(400, "Bad Request: chat not found")).toMatch(/Chat not found/);
  });
});
