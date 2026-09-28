import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeAccount, Settings } from "@/lib/domain/types";
import { SETTINGS_KEY } from "@/lib/storage/repositories";

/* Two browser tabs of the app = two module instances over ONE storage.
   The browser calls a tab's `storage` listeners when ANOTHER tab writes. */
const data = new Map<string, string>();
let quotaFull = false;
type Listener = (e: { key: string | null }) => void;
let listeners: Listener[] = [];
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (quotaFull) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  },
  addEventListener: (type: string, fn: Listener) => {
    if (type === "storage") listeners.push(fn);
  },
};

const account: ExchangeAccount = { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false };
const stored = () => JSON.parse(data.get(SETTINGS_KEY) ?? "{}") as Settings;

/** A tab: its own module instance, and the listeners it registered. */
async function openTab() {
  vi.resetModules();
  const before = listeners.length;
  const mod = await import("./settings");
  mod.currentSettings(); // the first read, as the page's first render does
  const own = listeners.slice(before);
  return { ...mod, hears: (key: string) => own.forEach((l) => l({ key })) };
}

beforeEach(() => {
  data.clear();
  listeners = [];
  quotaFull = false;
});

describe("settings across two tabs", () => {
  it("a change in tab B no longer brings back an exchange account deleted in tab A", async () => {
    const A = await openTab();
    A.updateSettings((s) => ({ ...s, keys: { ...s.keys, exchanges: [account] } }));
    const B = await openTab(); // opened while the account existed
    A.updateSettings((s) => ({ ...s, keys: { ...s.keys, exchanges: [] } }));
    B.updateSettings((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }));
    expect(stored().keys.exchanges).toEqual([]);
    expect(stored().theme).toBe("light");
  });

  it("tab B sees tab A's change as soon as the browser signals it", async () => {
    const A = await openTab();
    const B = await openTab();
    A.updateSettings((s) => ({ ...s, keys: { ...s.keys, openrouter: "sk-new" } }));
    expect(B.currentSettings().keys.openrouter).toBe("");
    B.hears(SETTINGS_KEY);
    expect(B.currentSettings().keys.openrouter).toBe("sk-new");
    /* Other keys are ignored; a cleared storage (`key: null`) is re-read. */
    A.updateSettings((s) => ({ ...s, theme: "light" }));
    B.hears("agentchat:ui");
    expect(B.currentSettings().theme).toBe("dark");
    B.hears(null as unknown as string);
    expect(B.currentSettings().theme).toBe("light");
  });

  it("a change that did not fit in storage is not dropped by the next one", async () => {
    const A = await openTab();
    quotaFull = true;
    A.updateSettings((s) => ({ ...s, theme: "light" }));
    A.updateSettings((s) => ({ ...s, keys: { ...s.keys, bytnode: "cb_test" } }));
    expect(A.currentSettings().theme).toBe("light");
    expect(A.currentSettings().keys.bytnode).toBe("cb_test");
    /* Another tab's signal does not replace what is ahead here either. */
    A.hears(SETTINGS_KEY);
    expect(A.currentSettings().theme).toBe("light");
    quotaFull = false;
    A.updateSettings((s) => s);
    expect(stored().theme).toBe("light");
  });
});
