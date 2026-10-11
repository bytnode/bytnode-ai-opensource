import { describe, expect, test } from "vitest";
import { findBot, sendToBot } from "../shared/telegram";
import { alertTelegramText, newAlert } from "./alerts";

describe("an alert's Telegram bot", () => {
  test("is kept on the alert when asked, never otherwise", () => {
    const made = newAlert({ target: "BTC/USDT", condition: "price > 100000", telegramBot: "t1" }, "a", new Date());
    expect("error" in made ? null : made.alert.telegramBot).toBe("t1");
    const plain = newAlert({ target: "BTC/USDT", condition: "price > 100000", telegramBot: "  " }, "a", new Date());
    expect("error" in plain ? "x" : plain.alert.telegramBot).toBeUndefined();
  });
  test("receives the asset, the condition, what was read and the note", () => {
    const text = alertTelegramText({ symbol: "BTC/USDT", condition: "price > 100000", observed: "price 100 250", note: "take profit" });
    expect(text.startsWith("🔔 BTC/USDT: ")).toBe(true);
    expect(text).toContain("price 100 250");
    expect(text.endsWith("take profit")).toBe(true);
  });
});

describe("sending to a bot", () => {
  const bots = [
    { id: "t1", name: "Desk bot", token: "123456:abc", chatId: "42", chatName: "Ben" },
    { id: "t2", name: "Half done", token: "", chatId: "", chatName: "" },
  ];
  test("finds a bot by id or by name", () => {
    expect(findBot(bots, "t1")?.name).toBe("Desk bot");
    expect(findBot(bots, " desk BOT ")?.id).toBe("t1");
    expect(findBot(bots, "nope")).toBeUndefined();
  });
  test("does nothing without a bot, says why it cannot send", async () => {
    expect(await sendToBot({ telegramBots: bots }, undefined, "x")).toEqual({ sent: false });
    expect((await sendToBot({ telegramBots: bots }, "gone", "x")).error).toMatch(/no longer/);
    expect((await sendToBot({ telegramBots: bots }, "t2", "x")).error).toMatch(/not ready/);
    expect((await sendToBot(null, "t1", "x")).error).toMatch(/no longer/);
  });
});
