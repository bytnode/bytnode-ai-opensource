import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MAX_TEXT_BYTES, readTool } from "./read";
import type { ToolContext } from "../types";

/* A huge text file must not be loaded into memory in one block. The test
   file is sparse (truncate): it weighs 60 MB without writing them. */
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

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bytnode-read-"));
  const big = path.join(dir, "big.csv");
  await fs.writeFile(big, "");
  await fs.truncate(big, MAX_TEXT_BYTES + 1024);
  await fs.writeFile(path.join(dir, "small.txt"), "a\nb\n");
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("Read", () => {
  test("refuses a text file beyond the bound, saying what to do", async () => {
    const r = await readTool.execute({ file_path: "big.csv" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/MB/);
    expect(r.output).toMatch(/Grep|head|pandas/i);
  });
  test("reads a small file normally", async () => {
    const r = await readTool.execute({ file_path: "small.txt" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1\ta");
  });
});
