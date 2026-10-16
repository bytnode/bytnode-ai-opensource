import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createAppKey, readMe, startSignIn } from "./sign-in";

/* A bytnode.com of our own: the API the app calls once the browser is back. */
let api: http.Server | null = null;
afterEach(() => {
  api?.close();
  api = null;
});

type Handler = (route: string, body: unknown, auth: string | undefined) => { status: number; body: unknown };

function fakeApi(handle: Handler): Promise<{ site: string; api: string }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const r = handle(`${req.method} ${req.url}`, raw ? JSON.parse(raw) : null, req.headers.authorization);
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.body));
    });
  });
  api = server;
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ site: "https://bytnode.example", api: `http://127.0.0.1:${port}/api` });
    }),
  );
}

const CODE = "a".repeat(43);

/** What the bytnode.com page does once signed in: back to the app's listener. */
function browserComesBack(url: string, code = CODE): Promise<Response> {
  const u = new URL(url);
  const back = `http://127.0.0.1:${u.searchParams.get("port")}/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get("state")!)}`;
  return fetch(back, { redirect: "manual" });
}

describe("the account sign-in, server side", () => {
  it("exchanges the code with the PKCE verifier for a session, and sends the browser back", async () => {
    let sent: { code?: string; code_verifier?: string } = {};
    const urls = await fakeApi((route, body) => {
      if (route !== "POST /api/auth/desktop/token") return { status: 404, body: null };
      sent = body as typeof sent;
      return { status: 200, body: { token: "bnd_t", account: { email: "ada@example.com", name: "Ada", avatar_url: null } } };
    });
    let landing: Promise<Response> | null = null;
    const run = startSignIn(urls, (url) => {
      expect(url).toMatch(/^https:\/\/bytnode\.example\/auth\/desktop\?challenge=/);
      landing = browserComesBack(url);
    });
    expect(await run.result).toEqual({ ok: true, session: { token: "bnd_t", account: { email: "ada@example.com", name: "Ada", avatarUrl: null } } });
    expect(sent.code).toBe(CODE);
    expect(sent.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const back = await landing!;
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("https://bytnode.example/auth/desktop?done=1");
  });

  it("gives bytnode.com's refusal", async () => {
    const urls = await fakeApi(() => ({ status: 400, body: { error: { code: "invalid_grant", message: "This sign-in link has expired." } } }));
    const run = startSignIn(urls, (url) => void browserComesBack(url));
    expect(await run.result).toEqual({ ok: false, cancelled: false, message: "This sign-in link has expired." });
  });

  it("ignores a caller without the state, and can be cancelled", async () => {
    const urls = await fakeApi(() => ({ status: 500, body: null }));
    let opened: (port: string) => void = () => {};
    const port = new Promise<string>((r) => (opened = r));
    const run = startSignIn(urls, (url) => opened(new URL(url).searchParams.get("port")!));
    const stray = await fetch(`http://127.0.0.1:${await port}/callback?code=${CODE}&state=wrong`);
    expect(stray.status).toBe(404);
    run.cancel();
    expect(await run.result).toEqual({ ok: false, cancelled: true, message: "" });
  });

  it("says the browser could not be opened", async () => {
    const urls = await fakeApi(() => ({ status: 500, body: null }));
    const run = startSignIn(urls, () => {
      throw new Error("no handler");
    });
    expect(await run.result).toEqual({ ok: false, cancelled: false, message: "The browser could not be opened (no handler)." });
  });

  it("makes the app's key and checks the session with the bearer token", async () => {
    const urls = await fakeApi((route, _body, auth) => {
      if (auth !== "Bearer bnd_t") return { status: 401, body: { error: { code: "unauthorized", message: "Session revoked." } } };
      if (route === "POST /api/desktop/api-key") return { status: 201, body: { secret: "cb_live_s" } };
      if (route === "GET /api/desktop/me") return { status: 200, body: { email: "ada@example.com", name: null, avatar_url: null } };
      return { status: 404, body: null };
    });
    expect(await createAppKey(urls, "bnd_t")).toEqual({ ok: true, secret: "cb_live_s" });
    expect(await createAppKey(urls, "bnd_old")).toEqual({ ok: false, code: "unauthorized", message: "Session revoked.", revoked: true });
    expect(await readMe(urls, "bnd_t")).toEqual({ kind: "ok", account: { email: "ada@example.com", name: null, avatarUrl: null } });
    expect(await readMe(urls, "bnd_old")).toEqual({ kind: "revoked", message: "Session revoked." });
    expect(await readMe({ site: "x", api: "http://127.0.0.1:1/api" }, "bnd_t")).toEqual({ kind: "unknown" });
  });
});
