import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pluginStore, updateJson, withLock } from "./store";

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

  it("a file that exists but cannot be read is an error, never an empty list", async () => {
    const store = pluginStore("x", root);
    /* A folder where the file should be: EISDIR, like any unreadable file. */
    await fs.mkdir(store.file("tasks.json"), { recursive: true });
    await expect(store.read("tasks.json", [])).rejects.toThrow();
    await expect(store.update("tasks.json", [], (l: number[]) => [...l, 1])).rejects.toThrow();
  });

  it("refuses a file name that is a path", () => {
    const store = pluginStore("x", root);
    expect(() => store.file("../escape.json")).toThrow(/Invalid data file name/);
    expect(() => store.file("a/b.json")).toThrow(/Invalid data file name/);
    /* Windows' device names, refused on every system. */
    for (const n of ["con.json", "NUL.json", "com1.json", "lpt9"]) expect(() => store.file(n), n).toThrow(/Invalid data file name/);
    expect(store.file("console.json")).toContain("console.json");
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

  it("several waiters on a stale lock: ONE takes it over, no update is lost", async () => {
    let worst = 0;
    let lost = 0;
    for (let trial = 0; trial < 10; trial++) {
      const file = path.join(root, `f${trial}.json`);
      await fs.writeFile(file, JSON.stringify({ n: 0 }));
      await fs.writeFile(`${file}.lock`, "");
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(`${file}.lock`, old, old);
      let inside = 0;
      await Promise.all(
        Array.from({ length: 4 }, () =>
          updateJson<{ n: number }>(file, { n: 0 }, async (cur) => {
            inside++;
            worst = Math.max(worst, inside);
            await new Promise((r) => setTimeout(r, 15));
            inside--;
            return { n: cur.n + 1 };
          }),
        ),
      );
      if ((JSON.parse(await fs.readFile(file, "utf8")) as { n: number }).n !== 4) lost++;
    }
    expect(worst).toBe(1);
    expect(lost).toBe(0);
  }, 60_000);

  it("a holder whose lock was taken over does not remove the new holder's lock", async () => {
    const file = path.join(root, "t.json");
    await withLock(file, async () => {
      /* Someone took it over while we were slow. */
      await fs.writeFile(`${file}.lock`, "someone-else");
    });
    expect(await fs.readFile(`${file}.lock`, "utf8")).toBe("someone-else");
  });
});

describe("removeLines", () => {
  it("removes the picked lines, keeps the others in order, says how many went", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "store-rm-"));
    try {
      const s = pluginStore("p", dir);
      for (const id of ["a", "b", "c"]) await s.append("runs.jsonl", { id });
      expect(await s.removeLines<{ id: string }>("runs.jsonl", (e) => e.id === "b")).toBe(1);
      expect(await s.lines("runs.jsonl")).toEqual([{ id: "a" }, { id: "c" }]);
      expect(await s.removeLines<{ id: string }>("runs.jsonl", (e) => e.id === "zz")).toBe(0);
      expect(await s.removeLines("runs.jsonl", () => true)).toBe(2);
      expect(await s.lines("runs.jsonl")).toEqual([]);
      await s.append("runs.jsonl", { id: "d" });
      expect(await s.lines("runs.jsonl")).toEqual([{ id: "d" }]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
