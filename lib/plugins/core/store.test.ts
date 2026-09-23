import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pluginStore, withLock } from "./store";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-store-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("pluginStore", () => {
  it("reads a fallback, writes, reads back", async () => {
    const store = pluginStore("watchlist", root);
    expect(await store.read("watchlist.json", { items: [] })).toEqual({ items: [] });
    await store.write("watchlist.json", { items: ["BTC/USDT"] });
    expect(await store.read("watchlist.json", { items: [] })).toEqual({ items: ["BTC/USDT"] });
    expect(store.file("watchlist.json")).toBe(path.join(root, "watchlist", "watchlist.json"));
  });

  it("concurrent updates never lose each other", async () => {
    const store = pluginStore("counter", root);
    await Promise.all(Array.from({ length: 20 }, () => store.update("n.json", { n: 0 }, (c) => ({ n: c.n + 1 }))));
    expect(await store.read("n.json", { n: 0 })).toEqual({ n: 20 });
  });

  it("keeps the last entries of a bounded journal", async () => {
    const store = pluginStore("scheduler", root);
    for (let i = 1; i <= 7; i++) await store.append("runs.jsonl", { i }, 5);
    expect((await store.lines<{ i: number }>("runs.jsonl")).map((r) => r.i)).toEqual([3, 4, 5, 6, 7]);
    await store.append("free.jsonl", { a: 1 });
    await store.append("free.jsonl", { a: 2 });
    expect(await store.lines("free.jsonl")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("skips a line cut by a crash", async () => {
    const store = pluginStore("x", root);
    await fs.mkdir(store.dir, { recursive: true });
    await fs.writeFile(store.file("j.jsonl"), '{"a":1}\n{"a":\n{"a":3}\n');
    expect(await store.lines("j.jsonl")).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("refuses a file name that is a path", () => {
    const store = pluginStore("x", root);
    expect(() => store.file("../escape.json")).toThrow(/Invalid data file name/);
    expect(() => store.file("a/b.json")).toThrow(/Invalid data file name/);
  });

  it("clears everything the plugin stored", async () => {
    const store = pluginStore("x", root);
    await store.write("a.json", 1);
    await store.clear();
    expect(await store.read("a.json", 0)).toBe(0);
  });
});

describe("withLock", () => {
  it("takes over a lock left by a dead process", async () => {
    const file = path.join(root, "d.json");
    await fs.writeFile(`${file}.lock`, "");
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(`${file}.lock`, old, old);
    expect(await withLock(file, async () => "ran")).toBe("ran");
  });
});
