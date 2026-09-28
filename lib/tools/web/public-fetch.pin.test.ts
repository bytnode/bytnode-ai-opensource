import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";

/* DNS rebinding: the name is resolved ONCE, checked, and the connection is
   made to that very address — never resolved again by the HTTP client. */

const lookups: string[] = [];
let answers: string[] = [];

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async (host: string) => {
      lookups.push(host);
      const address = answers.shift() ?? "127.0.0.1";
      return [{ address, family: 4 }];
    },
  },
}));

type Captured = { url: URL; options: { lookup: (h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => void; method: string } };
const requests: Captured[] = [];
/* Each fake request answers with the next status/location pair. */
let replies: Array<{ status: number; location?: string; body?: string }> = [];

vi.mock("node:http", () => ({
  default: {
    request: (url: URL, options: Captured["options"], cb: (res: unknown) => void) => {
      requests.push({ url, options });
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        const r = replies.shift() ?? { status: 200, body: "ok" };
        const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; complete: boolean; resume: () => void; destroy: () => void; pipe: unknown };
        res.statusCode = r.status;
        res.headers = r.location ? { location: r.location } : { "content-type": "text/plain" };
        res.complete = false;
        res.resume = () => {};
        res.destroy = () => {};
        cb(res);
        setTimeout(() => {
          if (r.body) res.emit("data", Buffer.from(r.body));
          res.complete = true;
          res.emit("end");
          res.emit("close");
        }, 0);
      };
      return req;
    },
  },
}));

const { publicFetch } = await import("./public-fetch");

beforeEach(() => {
  lookups.length = 0;
  requests.length = 0;
  answers = [];
  replies = [];
});

describe("publicFetch pins the checked address", () => {
  test("the HTTP client gets the address that was checked, whatever the DNS says next", async () => {
    /* First answer public (the check), any later one loopback (the rebind). */
    answers = ["8.8.4.4", "127.0.0.1"];
    const r = await publicFetch("http://rebind.example/data", { maxBytes: 1000 });
    expect(r.body.toString()).toBe("ok");
    expect(lookups).toEqual(["rebind.example"]);
    const got = await new Promise<unknown[]>((resolve) => requests[0].options.lookup("rebind.example", {}, (...a) => resolve(a)));
    expect(got).toEqual([null, "8.8.4.4", 4]);
    const all = await new Promise<unknown[]>((resolve) => requests[0].options.lookup("rebind.example", { all: true }, (...a) => resolve(a)));
    expect(all).toEqual([null, [{ address: "8.8.4.4", family: 4 }]]);
  });

  test("a name that resolves to loopback is refused before any connection", async () => {
    answers = ["127.0.0.1"];
    await expect(publicFetch("http://localtest.me/", { maxBytes: 1000 })).rejects.toThrow(/does not resolve to a public address/);
    expect(requests).toHaveLength(0);
  });

  test("redirects to another public host are followed, each hop checked; a private hop is refused", async () => {
    answers = ["8.8.4.4", "8.8.8.8"];
    replies = [{ status: 301, location: "http://www.other.example/x" }, { status: 200, body: "moved" }];
    const r = await publicFetch("http://other.example/", { maxBytes: 1000 });
    expect(r.url).toBe("http://www.other.example/x");
    expect(r.body.toString()).toBe("moved");
    expect(lookups).toEqual(["other.example", "www.other.example"]);

    answers = ["8.8.4.4"];
    replies = [{ status: 302, location: "http://127.0.0.1:3777/api/tools" }];
    await expect(publicFetch("http://evil.example/", { maxBytes: 1000 })).rejects.toThrow(/Local or private/);
  });

  test("the number of hops is bounded", async () => {
    answers = Array(10).fill("8.8.4.4");
    replies = Array(10).fill({ status: 302, location: "http://loop.example/" });
    await expect(publicFetch("http://loop.example/", { maxBytes: 1000, maxRedirects: 3 })).rejects.toThrow(/Too many redirects/);
    expect(requests).toHaveLength(4);
  });
});
