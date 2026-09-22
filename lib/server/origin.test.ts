import { describe, expect, test } from "vitest";
import { crossSiteReason } from "./origin";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("crossSiteReason", () => {
  test("from home: same-origin, or no marker at all (curl)", () => {
    expect(crossSiteReason(h({ "sec-fetch-site": "same-origin", origin: "http://localhost:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ "sec-fetch-site": "none", host: "localhost:3777" }))).toBeNull();
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
