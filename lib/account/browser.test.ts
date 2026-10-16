import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@/lib/storage/storage";
import { ACCOUNT_STORAGE_KEY, createBrowserBridge, type SignInTab } from "./browser";

const account = { email: "ada@example.com", name: "Ada Lovelace", avatarUrl: null };

type Call = { url: string; method: string; session: string | null };

/** The app's server, scripted: one answer per call, in order. */
function world(answers: Array<unknown>) {
  const storage = new MemoryStorage();
  const calls: Call[] = [];
  const tabs: Array<{ went: string[]; closed: boolean }> = [];
  const bridge = createBrowserBridge({
    storage,
    fetch: async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init?.method ?? "GET", session: headers["x-bytnode-session"] ?? null });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next ?? {}), { status: 200 });
    },
    openTab: (): SignInTab => {
      const t = { went: [] as string[], closed: false };
      tabs.push(t);
      return { go: (u) => void t.went.push(u), close: () => void (t.closed = true) };
    },
    pause: async () => {},
  });
  return { storage, calls, tabs, bridge };
}

describe("the BytNode account in a browser", () => {
  it("signs in through a tab sent to bytnode.com, keeps the session, closes the tab", async () => {
    const w = world([{ id: "run1", url: "https://bytnode.com/auth/desktop?x" }, { pending: true }, { ok: true, session: { token: "bnd_abc", account } }]);
    const changes: unknown[] = [];
    w.bridge.onChange((s) => changes.push(s));
    expect(w.bridge.state()).toEqual({ signedIn: false, reason: null });
    const r = await w.bridge.signIn();
    expect(r).toEqual({ ok: true, account });
    expect(w.tabs[0]).toEqual({ went: ["https://bytnode.com/auth/desktop?x"], closed: true });
    expect(w.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/account/sign-in", "GET /api/account/sign-in?id=run1", "GET /api/account/sign-in?id=run1"]);
    expect(w.bridge.state()).toEqual({ signedIn: true, account });
    expect(JSON.parse(w.storage.get(ACCOUNT_STORAGE_KEY)!).token).toBe("bnd_abc");
    /* The sign-in page reads it again once the app is set up. */
    expect(changes).toEqual([]);
  });

  it("says so when the browser blocks the tab, and asks the server nothing", async () => {
    const calls: string[] = [];
    const bridge = createBrowserBridge({ storage: new MemoryStorage(), fetch: async (u) => (calls.push(u), new Response("{}")), openTab: () => null });
    const r = await bridge.signIn();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/^The browser could not be opened \(/);
    expect(calls).toEqual([]);
  });

  it("gives bytnode.com's refusal and leaves the tab open on it", async () => {
    const w = world([{ id: "run1", url: "https://x" }, { ok: false, cancelled: false, message: "This sign-in link has expired." }]);
    expect(await w.bridge.signIn()).toEqual({ ok: false, cancelled: false, message: "This sign-in link has expired." });
    expect(w.tabs[0].closed).toBe(false);
    expect(w.bridge.state()?.signedIn).toBe(false);
  });

  it("closes the tab when the server cannot start a sign-in", async () => {
    const w = world([{ ok: false, cancelled: false, message: "The app could not wait for the browser (EACCES)." }]);
    expect(await w.bridge.signIn()).toEqual({ ok: false, cancelled: false, message: "The app could not wait for the browser (EACCES)." });
    expect(w.tabs[0].closed).toBe(true);
  });

  it("waits on through a server that does not answer for a moment", async () => {
    const w = world([{ id: "run1", url: "https://x" }, new Error("fetch failed"), { ok: true, session: { token: "bnd_abc", account } }]);
    expect((await w.bridge.signIn()).ok).toBe(true);
  });

  it("cancels: the server forgets the sign-in, the tab closes", async () => {
    const w = world([{ id: "run1", url: "https://x" }]);
    const pending = w.bridge.signIn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await w.bridge.cancel();
    expect(await pending).toEqual({ ok: false, cancelled: true, message: "" });
    expect(w.tabs[0].closed).toBe(true);
    expect(w.calls.some((c) => c.method === "DELETE" && c.url === "/api/account/sign-in?id=run1")).toBe(true);
  });

  it("a second sign-in cancels the first and closes its tab", async () => {
    const w = world([{ id: "run1", url: "https://x" }]);
    const first = w.bridge.signIn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const second = w.bridge.signIn();
    expect(await first).toEqual({ ok: false, cancelled: true, message: "" });
    expect(w.tabs[0].closed).toBe(true);
    expect(w.tabs).toHaveLength(2);
    void second;
  });

  it("makes the app's key with the session, and signs out when bytnode.com refuses it", async () => {
    const w = world([{ ok: true, secret: "cb_live_x" }, { ok: false, code: "unauthorized", message: "Session revoked.", revoked: true }]);
    w.storage.set(ACCOUNT_STORAGE_KEY, JSON.stringify({ token: "bnd_abc", account }));
    expect(await w.bridge.createApiKey()).toEqual({ ok: true, secret: "cb_live_x" });
    expect(w.calls[0]).toEqual({ url: "/api/account/key", method: "POST", session: "bnd_abc" });
    expect(await w.bridge.createApiKey()).toEqual({ ok: false, code: "unauthorized", message: "Session revoked." });
    expect(w.bridge.state()).toEqual({ signedIn: false, reason: "Session revoked." });
  });

  it("checks the session at start: revoked → signed out with the reason; offline → kept", async () => {
    const w = world([new Error("offline"), { kind: "revoked", message: "Signed out on bytnode.com." }]);
    w.storage.set(ACCOUNT_STORAGE_KEY, JSON.stringify({ token: "bnd_abc", account }));
    await w.bridge.check();
    expect(w.bridge.state()?.signedIn).toBe(true);
    await w.bridge.check();
    expect(w.bridge.state()).toEqual({ signedIn: false, reason: "Signed out on bytnode.com." });
  });

  it("signs out here first, then revokes on bytnode.com", async () => {
    const w = world([{}]);
    w.storage.set(ACCOUNT_STORAGE_KEY, JSON.stringify({ token: "bnd_abc", account }));
    await w.bridge.signOut();
    expect(w.bridge.state()).toEqual({ signedIn: false, reason: null });
    expect(w.calls).toEqual([{ url: "/api/account/session", method: "DELETE", session: "bnd_abc" }]);
  });

  it("ignores a stored session that is not one", () => {
    const w = world([]);
    w.storage.set(ACCOUNT_STORAGE_KEY, JSON.stringify({ token: "nope", account }));
    expect(w.bridge.state()?.signedIn).toBe(false);
    w.storage.set(ACCOUNT_STORAGE_KEY, "{broken");
    expect(w.bridge.state()?.signedIn).toBe(false);
  });
});
