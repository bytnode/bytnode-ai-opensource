import { describe, expect, test } from "vitest";
import type { Settings } from "@/lib/domain/types";
import { SETTINGS_KEY, SettingsRepository, defaultSettings } from "./repositories";
import { emptyBag, hasSecrets, mergeSecrets, readBag, splitSecrets, type SecretBag, type Vault } from "./secrets";
import type { Storage } from "./storage";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get(k: string) {
    return this.data.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.data.set(k, v);
    return true;
  }
  remove(k: string) {
    this.data.delete(k);
  }
}

class MemoryVault implements Vault {
  bag: SecretBag | null = emptyBag();
  ok = true;
  get() {
    return this.bag ? structuredClone(this.bag) : null;
  }
  set(bag: SecretBag) {
    if (!this.ok) return false;
    this.bag = structuredClone(bag);
    return true;
  }
}

const withKeys = (): Settings => ({
  ...defaultSettings(),
  onboardingDone: true,
  keys: {
    openrouter: "sk-or-v1-abc",
    bytnode: "cb_live_xyz",
    exchanges: [{ id: "x1", exchange: "bybit", label: "Bybit main", apiKey: "AK", secret: "SK", password: "PW", testnet: false }],
    telegram: [{ id: "t1", name: "Desk bot", token: "123456:TELEGRAM-TOKEN", chatId: "42", chatName: "Ben" }],
  },
});

describe("splitSecrets / mergeSecrets", () => {
  test("take every key out and put it back", () => {
    const { stripped, bag } = splitSecrets(withKeys());
    expect(hasSecrets(stripped)).toBe(false);
    expect(stripped.keys.exchanges[0]).toMatchObject({ id: "x1", label: "Bybit main", apiKey: "", secret: "", password: "" });
    expect(stripped.keys.telegram[0]).toMatchObject({ id: "t1", name: "Desk bot", token: "", chatId: "42" });
    expect(bag).toEqual({ openrouter: "sk-or-v1-abc", bytnode: "cb_live_xyz", exchanges: { x1: { apiKey: "AK", secret: "SK", password: "PW" } }, telegram: { t1: "123456:TELEGRAM-TOKEN" } });
    expect(mergeSecrets(stripped, bag)).toEqual(withKeys());
  });
  test("a key still in the stored copy wins over the vault's", () => {
    const s = withKeys();
    expect(mergeSecrets(s, { ...emptyBag(), openrouter: "old" }).keys.openrouter).toBe("sk-or-v1-abc");
  });
  test("read whatever the vault returns", () => {
    expect(readBag(null)).toEqual(emptyBag());
    expect(readBag({ openrouter: 1, exchanges: { a: { apiKey: "k" } }, telegram: { t: "tok", u: 3 } })).toEqual({ openrouter: "", bytnode: "", exchanges: { a: { apiKey: "k", secret: "", password: "" } }, telegram: { t: "tok", u: "" } });
  });
});

describe("SettingsRepository with a vault", () => {
  test("never writes a key in the plain storage, and reads it back", () => {
    const storage = new MemoryStorage();
    const vault = new MemoryVault();
    const repo = new SettingsRepository(storage, vault);
    repo.save(withKeys());
    const raw = storage.get(SETTINGS_KEY)!;
    expect(raw).not.toContain("sk-or-v1-abc");
    expect(raw).not.toContain("cb_live_xyz");
    expect(raw).not.toContain('"SK"');
    expect(raw).not.toContain("TELEGRAM-TOKEN");
    expect(raw).toContain("Bybit main");
    expect(repo.load()).toEqual(withKeys());
  });
  test("moves keys found in plain storage into the vault", () => {
    const storage = new MemoryStorage();
    new SettingsRepository(storage).save(withKeys());
    const vault = new MemoryVault();
    expect(new SettingsRepository(storage, vault).load()).toEqual(withKeys());
    expect(storage.get(SETTINGS_KEY)).not.toContain("sk-or-v1-abc");
    expect(vault.bag?.openrouter).toBe("sk-or-v1-abc");
  });
  test("a vault that refuses keeps the keys where they were, never loses them", () => {
    const storage = new MemoryStorage();
    const vault = new MemoryVault();
    vault.ok = false;
    new SettingsRepository(storage, vault).save(withKeys());
    expect(storage.get(SETTINGS_KEY)).toContain("sk-or-v1-abc");
  });
  test("no vault: unchanged behaviour", () => {
    const storage = new MemoryStorage();
    const repo = new SettingsRepository(storage);
    repo.save(withKeys());
    expect(storage.get(SETTINGS_KEY)).toContain("sk-or-v1-abc");
    expect(repo.load()).toEqual(withKeys());
  });
});
