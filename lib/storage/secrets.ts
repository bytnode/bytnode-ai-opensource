import type { ExchangeAccount, Settings } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   The keys out of the plain storage, into the system's vault (user request,
   2026-10-08: « toutes les données API stockées dans les coffres-forts
   intégrés de chaque OS »).

   The settings live in localStorage, which is a plain file on disk: the
   OpenRouter key, the BytNode key, the exchange accounts' key, secret and
   passphrase and the Telegram bots' tokens could be read by anything that
   copies it. When the app runs in its desktop window, a VAULT is offered
   (`desktop/vault.ts`:
   Windows DPAPI, the macOS Keychain, libsecret on Linux, through Electron's
   safeStorage): the settings are written WITHOUT those fields, which go to
   the vault, and put back together when read. The rest of the app sees the
   same `Settings` as before.

   No vault (the browser, behind the `bytnode-ai` command; a Linux with no
   keyring): nothing changes. Keys found in plain storage while a vault is
   there (written before it existed) are moved into it at the next read.
   Pure, tested.
--------------------------------------------------------------------------- */

export type ExchangeSecrets = Pick<ExchangeAccount, "apiKey" | "secret" | "password">;

export type SecretBag = {
  openrouter: string;
  bytnode: string;
  /** By account id. */
  exchanges: Record<string, ExchangeSecrets>;
  /** The Telegram bots' tokens, by bot id. */
  telegram: Record<string, string>;
};

/** What the desktop window hands the page (`desktop/preload.ts`). */
export type Vault = {
  get(): SecretBag | null;
  set(bag: SecretBag): boolean;
};

export const emptyBag = (): SecretBag => ({ openrouter: "", bytnode: "", exchanges: {}, telegram: {} });

/** The settings without their secrets, and the secrets. Pure. */
export function splitSecrets(s: Settings): { stripped: Settings; bag: SecretBag } {
  const bag: SecretBag = { openrouter: s.keys.openrouter, bytnode: s.keys.bytnode, exchanges: {}, telegram: {} };
  const exchanges = s.keys.exchanges.map((a) => {
    bag.exchanges[a.id] = { apiKey: a.apiKey, secret: a.secret, password: a.password };
    return { ...a, apiKey: "", secret: "", password: "" };
  });
  const telegram = s.keys.telegram.map((b) => {
    bag.telegram[b.id] = b.token;
    return { ...b, token: "" };
  });
  return { stripped: { ...s, keys: { ...s.keys, openrouter: "", bytnode: "", exchanges, telegram } }, bag };
}

/** Does the stored copy still carry a secret (written before the vault)? Pure. */
export function hasSecrets(s: Settings): boolean {
  return !!(s.keys.openrouter || s.keys.bytnode || s.keys.exchanges.some((a) => a.apiKey || a.secret || a.password) || s.keys.telegram.some((b) => b.token));
}

/** The settings with their secrets back: the vault's, unless the stored
    copy carries one itself (older than the vault: it wins, and is moved
    in at the next save). Pure. */
export function mergeSecrets(s: Settings, bag: SecretBag): Settings {
  const pick = (stored: string, vaulted: string | undefined) => stored || vaulted || "";
  return {
    ...s,
    keys: {
      ...s.keys,
      openrouter: pick(s.keys.openrouter, bag.openrouter),
      bytnode: pick(s.keys.bytnode, bag.bytnode),
      exchanges: s.keys.exchanges.map((a) => {
        const v = bag.exchanges[a.id];
        return { ...a, apiKey: pick(a.apiKey, v?.apiKey), secret: pick(a.secret, v?.secret), password: pick(a.password, v?.password) };
      }),
      telegram: s.keys.telegram.map((b) => ({ ...b, token: pick(b.token, bag.telegram?.[b.id]) })),
    },
  };
}

/** A bag read back from the vault, whatever it holds. Pure. */
export function readBag(raw: unknown): SecretBag {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const exchanges: Record<string, ExchangeSecrets> = {};
  const ex = o.exchanges && typeof o.exchanges === "object" ? (o.exchanges as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(ex)) {
    const e = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    exchanges[id] = { apiKey: str(e.apiKey), secret: str(e.secret), password: str(e.password) };
  }
  const telegram: Record<string, string> = {};
  const tg = o.telegram && typeof o.telegram === "object" ? (o.telegram as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(tg)) telegram[id] = str(v);
  return { openrouter: str(o.openrouter), bytnode: str(o.bytnode), exchanges, telegram };
}
