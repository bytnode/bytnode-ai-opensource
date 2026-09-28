import os from "node:os";
import { describe, expect, test } from "vitest";
import { LineKeeper, monitorTool } from "./monitor";
import type { ToolContext } from "../types";

const ctx = (): ToolContext => ({
  workspace: os.tmpdir(),
  scope: "disk",
  projectRoot: process.cwd(),
  signal: new AbortController().signal,
  emit: () => {},
  depth: 0,
  llm: { apiKey: "", model: "", effort: null },
  callId: "t",
});

describe("LineKeeper", () => {
  test("keeps the first and the latest lines, says how many fell between", () => {
    const k = new LineKeeper(2, 3);
    for (let i = 1; i <= 10; i++) k.push(`l${i}`);
    expect(k.text()).toBe("l1\nl2\n[… 5 lines not kept …]\nl8\nl9\nl10");
    expect(k.count).toBe(10);
  });
  test("keeps nothing after the matching line", () => {
    const k = new LineKeeper(2, 3);
    k.push("a");
    k.push("DONE");
    k.close();
    k.push("after");
    expect(k.text()).toBe("a\nDONE");
  });
});

describe("Monitor", () => {
  test("the line that matched `until` reaches the model, after 800 others", async () => {
    const r = await monitorTool.execute({ command: "seq 1 800; echo DONE", until: "DONE", timeout: 30_000 }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("\nDONE\n");
    expect(r.output).toMatch(/lines not kept/);
    expect(r.output).toMatch(/stopped: pattern matched/);
  }, 40_000);

  test("a command that exits with an error is a failure", async () => {
    const r = await monitorTool.execute({ command: "echo x; exit 5", timeout: 30_000 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/finished with code 5/);
  }, 40_000);

  test("a WebSocket to this machine, or a URL that is not ws(s), is refused", async () => {
    for (const url of ["ws://127.0.0.1:3777/ws", "ws://localhost:3777/", "http://127.0.0.1:3899/", "wss://[::1]/", "ws://192.168.1.10/"]) {
      const r = await monitorTool.execute({ url }, ctx());
      expect(r.ok, url).toBe(false);
      expect(r.output, url).toMatch(/Could not watch/);
    }
  });
});
