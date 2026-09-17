import { describe, expect, test } from "vitest";
import { crossSiteReason } from "./origin";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("crossSiteReason", () => {
  test("la maison : same-origin, ou aucun marqueur (curl)", () => {
    expect(crossSiteReason(h({ "sec-fetch-site": "same-origin", origin: "http://localhost:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ "sec-fetch-site": "none", host: "localhost:3777" }))).toBeNull();
  });
  test("une autre page, un autre port : refuse", () => {
    expect(crossSiteReason(h({ "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "localhost:3777" }))).toBe("requête cross-site");
    expect(crossSiteReason(h({ "sec-fetch-site": "same-site", origin: "http://localhost:3000", host: "localhost:3777" }))).toBe("requête same-site");
  });
  test("sans Sec-Fetch-Site, l'origine doit etre l'hote", () => {
    expect(crossSiteReason(h({ origin: "http://localhost:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ origin: "http://LOCALHOST:3777", host: "localhost:3777" }))).toBeNull();
    expect(crossSiteReason(h({ origin: "http://evil.example", host: "localhost:3777" }))).toBe("origine evil.example");
    expect(crossSiteReason(h({ origin: "null", host: "localhost:3777" }))).toBe("origine opaque");
    expect(crossSiteReason(h({ origin: "n'importe quoi", host: "localhost:3777" }))).toBe("origine illisible");
  });
});
