import { describe, expect, test } from "vitest";
import { crossSiteReason, selfOrigin } from "./origin";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("crossSiteReason", () => {
  test("from home: same-origin, or no marker at all (curl)", () => {
    expect(crossSiteReason(h({ "sec-fetch-site": "same-origin", origin: "http://localhost:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ "sec-fetch-site": "none", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ host: "127.0.0.1:3777" }), { port: "3777" })).toBeNull();
    expect(crossSiteReason(h({ host: "[::1]:3777", origin: "http://[::1]:3777" }), { port: 3777 })).toBeNull();
  });
  test("another page, another port: refused", () => {
    expect(crossSiteReason(h({ "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "localhost:3777" }))).toBe("cross-site request");
    expect(crossSiteReason(h({ "sec-fetch-site": "same-site", origin: "http://localhost:3000", host: "localhost:3777" }))).toBe("same-site request");
  });
  test("without Sec-Fetch-Site, the origin must be the host", () => {
    expect(crossSiteReason(h({ origin: "http://localhost:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ origin: "http://LOCALHOST:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ origin: "http://evil.example", host: "localhost:3777" }))).toBe("origin evil.example");
    expect(crossSiteReason(h({ origin: "null", host: "localhost:3777" }))).toBe("opaque origin");
    expect(crossSiteReason(h({ origin: "whatever", host: "localhost:3777" }))).toBe("unreadable origin");
  });
});

/* DNS rebinding: the attacker's page and the request share the attacker's
   name, so Origin === Host and Sec-Fetch-Site says same-origin. */
describe("crossSiteReason: the Host must be the loopback the app is served on", () => {
  test("a foreign name is refused even when everything else says same-origin", () => {
    for (const host of ["evil.test:3777", "192.168.1.50:3777", "attacker.com", "127.0.0.1.nip.io:3777", "localhost.:3777"]) {
      expect(crossSiteReason(h({ "sec-fetch-site": "same-origin", origin: `http://${host}`, host })), host).toBe(`host ${host}`);
      expect(crossSiteReason(h({ host })), host).toBe(`host ${host}`);
    }
  });
  test("the wrong port is refused when the served port is known", () => {
    expect(crossSiteReason(h({ host: "127.0.0.1:9999" }), { port: "3777" })).toBe("host 127.0.0.1:9999");
    expect(crossSiteReason(h({ host: "localhost" }), { port: "3777" })).toBe("host localhost");
    expect(crossSiteReason(h({ host: "localhost" }), { port: "80" })).toBeNull();
  });
  test("no Host but a browser Origin: refused; neither: a bare client, let through", () => {
    expect(crossSiteReason(h({ origin: "http://evil.test" }))).toBe("origin without a host");
    expect(crossSiteReason(h({ host: "", origin: "http://evil.test" }))).toBe("origin without a host");
    expect(crossSiteReason(h({}))).toBeNull();
  });
  test("the Origin's scheme counts", () => {
    expect(crossSiteReason(h({ origin: "https://127.0.0.1:3795", host: "127.0.0.1:3795" }))).toBe("origin https://127.0.0.1:3795");
  });
});

describe("the desktop app's window port", () => {
  test("is accepted beside the served one, nothing else", () => {
    const opts = { port: "51234", windowPort: "23777" };
    expect(crossSiteReason(h({ host: "127.0.0.1:23777", origin: "http://127.0.0.1:23777" }), opts)).toBeNull();
    expect(crossSiteReason(h({ host: "127.0.0.1:51234" }), opts)).toBeNull();
    expect(crossSiteReason(h({ host: "127.0.0.1:9999" }), opts)).toBe("host 127.0.0.1:9999");
    expect(crossSiteReason(h({ host: "127.0.0.1:23777" }), { port: "51234" })).toBe("host 127.0.0.1:23777");
  });
  test("the server's own origin for its children is the real one", () => {
    expect(selfOrigin("http://127.0.0.1:23777/api/acp/prompt", { BYTNODE_AI_SELF_ORIGIN: "http://127.0.0.1:51234" })).toBe("http://127.0.0.1:51234");
    expect(selfOrigin("http://localhost:3777/api/acp/prompt", {})).toBe("http://localhost:3777");
  });
});
