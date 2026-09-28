import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext } from "@/lib/tools/types";
import { bounded, chartTool } from "./chart";

let dir: string;
const ctx = (): ToolContext => ({
  workspace: dir,
  scope: "workspace",
  projectRoot: process.cwd(),
  signal: new AbortController().signal,
  emit: () => {},
  depth: 0,
  llm: { apiKey: "", model: "", effort: null },
  callId: "c",
});

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-chart-"));
  const rows = Array.from({ length: 30 }, (_, i) => `${1_700_000_000_000 + i * 3_600_000},${100 + i},${102 + i},${99 + i},${101 + i},${10 + i}`);
  await fs.writeFile(path.join(dir, "c.csv"), ["timestamp,open,high,low,close,volume", ...rows].join("\n"));
});
afterAll(async () => fs.rm(dir, { recursive: true, force: true }));

/** The PNG's size, from its IHDR chunk. */
const size = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

describe("Chart", () => {
  it("clamps any size it is sent to the schema's bounds (a direct caller skips the schema)", async () => {
    const r = await chartTool.execute({ data: "c.csv", width: 100_000, height: 100_000 }, ctx());
    expect(r.ok).toBe(true);
    const png = await fs.readFile(path.join(dir, "out", "charts", "c.png"));
    expect(size(png).width).toBeLessThanOrEqual(2400);
    expect(size(png).height).toBeLessThanOrEqual(1600 * 2);
  }, 30_000);

  it("an empty CSV is named, not quoted as an empty header", async () => {
    await fs.writeFile(path.join(dir, "empty.csv"), "");
    expect((await chartTool.execute({ data: "empty.csv" }, ctx())).output).toMatch(/^empty\.csv is empty/);
    await fs.writeFile(path.join(dir, "junk.csv"), "a,b\n1,2\n");
    expect((await chartTool.execute({ data: "junk.csv" }, ctx())).output).toMatch(/^No price column recognised in junk\.csv \(columns: a, b\)/);
  });

  it("bounded: numbers are clamped and rounded, anything else falls back", () => {
    expect(bounded(100_000, 320, 2400, 1100)).toBe(2400);
    expect(bounded(-5, 2, 3000, 3000)).toBe(2);
    expect(bounded(10.6, 2, 3000, 3000)).toBe(11);
    expect(bounded("100000", 320, 2400, 1100)).toBe(1100);
    expect(bounded(Number.NaN, 320, 2400, 1100)).toBe(1100);
    expect(bounded(undefined, 320, 2400, 1100)).toBe(1100);
  });
});
