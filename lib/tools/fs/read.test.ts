import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MAX_TEXT_BYTES, readTool } from "./read";
import type { ToolContext } from "../types";

/* Un fichier texte enorme ne doit pas etre charge en memoire d'un bloc. Le
   fichier de test est creux (truncate) : il pese 60 Mo sans les ecrire. */
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
  const big = path.join(dir, "gros.csv");
  await fs.writeFile(big, "");
  await fs.truncate(big, MAX_TEXT_BYTES + 1024);
  await fs.writeFile(path.join(dir, "petit.txt"), "a\nb\n");
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("Read", () => {
  test("refuse un fichier texte au-dela de la borne, en disant quoi faire", async () => {
    const r = await readTool.execute({ file_path: "gros.csv" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Mo/);
    expect(r.output).toMatch(/Grep|head|pandas/i);
  });
  test("lit un petit fichier normalement", async () => {
    const r = await readTool.execute({ file_path: "petit.txt" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1\ta");
  });
});
