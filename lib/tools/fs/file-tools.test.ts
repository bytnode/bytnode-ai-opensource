import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { editTool } from "./edit";
import { writeTool, lineCount } from "./write";
import { readTool, checkWindow, looksLikeImage } from "./read";
import { notebookEditTool, editNotebook } from "./notebook-edit";
import { globTool } from "./glob";
import type { ToolContext } from "../types";

let dir = "";
const ctx = (): ToolContext => ({
  workspace: dir,
  scope: "workspace",
  projectRoot: dir,
  signal: new AbortController().signal,
  emit: () => {},
  depth: 0,
  llm: { apiKey: "", model: "", effort: null },
  callId: "c",
});
const file = (name: string) => path.join(dir, name);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bytnode-fs-"));
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("Edit: encodings", () => {
  test("refuses a Windows-1252 file instead of corrupting its accents", async () => {
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6b, 0x0a]);
    await fs.writeFile(file("latin.txt"), latin);
    const r = await editTool.execute({ file_path: "latin.txt", old_string: "ok", new_string: "OK" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not UTF-8/);
    expect(await fs.readFile(file("latin.txt"))).toEqual(latin);
  });

  test("refuses a binary file", async () => {
    const bin = Buffer.from([0x00, 0x41, 0x42, 0xff, 0xfe, 0x43]);
    await fs.writeFile(file("bin.dat"), bin);
    const r = await editTool.execute({ file_path: "bin.dat", old_string: "AB", new_string: "ZZ" }, ctx());
    expect(r.ok).toBe(false);
    expect(await fs.readFile(file("bin.dat"))).toEqual(bin);
  });

  test("edits a UTF-16 file in its own encoding, and keeps a UTF-8 BOM", async () => {
    await fs.writeFile(file("u16.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("price=1\r\n", "utf16le")]));
    expect((await editTool.execute({ file_path: "u16.txt", old_string: "price=1", new_string: "price=2" }, ctx())).ok).toBe(true);
    expect(await fs.readFile(file("u16.txt"))).toEqual(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("price=2\r\n", "utf16le")]));
    await fs.writeFile(file("bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a é")]));
    expect((await editTool.execute({ file_path: "bom.txt", old_string: "a", new_string: "b" }, ctx())).ok).toBe(true);
    expect(await fs.readFile(file("bom.txt"))).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("b é")]));
  });
});

describe("Edit / Write: one file, many calls at once", () => {
  test("ten parallel Edits of one file all land (3 of 10 used to)", async () => {
    await fs.writeFile(file("conc.txt"), Array.from({ length: 10 }, (_, i) => `token${i}=old`).join("\n"));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => editTool.execute({ file_path: "conc.txt", old_string: `token${i}=old`, new_string: `token${i}=NEW` }, ctx())),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await fs.readFile(file("conc.txt"), "utf8")).toBe(Array.from({ length: 10 }, (_, i) => `token${i}=NEW`).join("\n"));
    const leftovers = (await fs.readdir(dir)).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  test("parallel Writes leave one complete content", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeTool.execute({ file_path: "w.txt", content: String(i).repeat(100_000) }, ctx())));
    const text = await fs.readFile(file("w.txt"), "utf8");
    expect(text.length).toBe(100_000);
    expect(new Set(text).size).toBe(1);
  });
});

describe("Write: names", () => {
  test("a path ending with a slash is not a file", async () => {
    const r = await writeTool.execute({ file_path: "dir/", content: "x" }, ctx());
    expect(r.ok).toBe(false);
    await expect(fs.stat(file("dir"))).rejects.toThrow();
  });
  test("a Windows device name or a trailing dot is refused", async () => {
    for (const name of ["CON", "sub/NUL.txt", "report."]) {
      const r = await writeTool.execute({ file_path: name, content: "x" }, ctx());
      expect(r.ok, name).toBe(false);
    }
  });
  test("an empty file is said so; a final newline opens no line", async () => {
    expect((await writeTool.execute({ file_path: "empty.txt", content: "" }, ctx())).output).toBe("empty.txt created (empty).");
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a")).toBe(1);
  });
});

describe("Read", () => {
  test("decodes a UTF-16 file (Windows PowerShell 5.1's `>`)", async () => {
    await fs.writeFile(file("ps.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello\r\n", "utf16le")]));
    const r = await readTool.execute({ file_path: "ps.txt" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1\thello");
  });
  test("an offset past the end says how long the file is", async () => {
    await fs.writeFile(file("lines.txt"), "a\nb\nc\n");
    const r = await readTool.execute({ file_path: "lines.txt", offset: 50 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/has 3 lines: offset 50 is past the end/);
    expect(checkWindow("a\nb", undefined, 0)).toMatch(/limit must be at least 1/);
  });
  test("an empty file is said to be empty", async () => {
    await fs.writeFile(file("void.txt"), "");
    expect((await readTool.execute({ file_path: "void.txt" }, ctx())).output).toBe("void.txt is empty.");
  });
  test("a text named .png is read as text, not sent as an image", async () => {
    await fs.writeFile(file("fake.png"), "not an image");
    const r = await readTool.execute({ file_path: "fake.png" }, ctx());
    expect(r.attachments).toBeUndefined();
    expect(r.output).toContain("not an image");
    expect(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
  });
});

describe("NotebookEdit: the first cell", () => {
  const empty = () => ({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });
  test("-1 inserts at the start, also into an empty notebook; the count appends", () => {
    const one = editNotebook(empty(), { cell_index: -1, edit_mode: "insert", new_source: "a" });
    expect(one.ok && one.notebook.cells.map((c) => c.source)).toEqual([["a"]]);
    if (!one.ok) return;
    const two = editNotebook(one.notebook, { cell_index: -1, edit_mode: "insert", new_source: "first" });
    expect(two.ok && two.notebook.cells.map((c) => c.source)).toEqual([["first"], ["a"]]);
    if (!two.ok) return;
    const three = editNotebook(two.notebook, { cell_index: 2, edit_mode: "insert", new_source: "last" });
    expect(three.ok && three.notebook.cells.map((c) => c.source)).toEqual([["first"], ["a"], ["last"]]);
    expect(editNotebook(empty(), { cell_index: 0, edit_mode: "replace", new_source: "x" })).toMatchObject({ ok: false });
    expect(editNotebook(empty(), { cell_index: -2, edit_mode: "insert", new_source: "x" })).toMatchObject({ ok: false });
  });
  test("the tool writes it", async () => {
    await fs.writeFile(file("nb.ipynb"), JSON.stringify(empty()));
    const r = await notebookEditTool.execute({ notebook_path: "nb.ipynb", cell_index: -1, edit_mode: "insert", new_source: "print(1)" }, ctx());
    expect(r.output).toBe("nb.ipynb: new cell inserted at index 0. The notebook has 1 cell.");
  });
});

describe("Glob", () => {
  test("no match names the workspace in words", async () => {
    expect((await globTool.execute({ pattern: "**/*.zzz" }, ctx())).output).toBe("No file matches `**/*.zzz` in the workspace.");
  });
});
