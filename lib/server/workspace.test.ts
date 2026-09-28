import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WorkspaceError, resolveWorkspace, safeAgentId, workspaceError } from "./workspace";

let home: string;
let before: string | undefined;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bn-ws-"));
  before = process.env.BYTNODE_AI_HOME;
  process.env.BYTNODE_AI_HOME = home;
});
afterAll(() => {
  if (before === undefined) delete process.env.BYTNODE_AI_HOME;
  else process.env.BYTNODE_AI_HOME = before;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("safeAgentId", () => {
  test("never names the workspaces root or the data folder", () => {
    expect(safeAgentId("..")).toBe("_");
    expect(safeAgentId(".")).toBe("_");
    expect(safeAgentId("../../x")).toBe("__.._x");
    expect(safeAgentId("agent-1")).toBe("agent-1");
    expect(safeAgentId("")).toBe("agent");
  });
});

describe("resolveWorkspace", () => {
  test("an id made of dots stays under workspaces/", async () => {
    const root = path.join(home, "workspaces");
    for (const id of ["..", "."]) {
      const dir = await resolveWorkspace(id, "");
      expect(path.dirname(dir)).toBe(root);
    }
  });

  test('"." means the default workspace, not the home folder', async () => {
    expect(await resolveWorkspace("a1", ".")).toBe(path.join(home, "workspaces", "a1"));
    expect(await resolveWorkspace("a1", "./")).toBe(path.join(home, "workspaces", "a1"));
  });

  test("a network (UNC) folder is refused, nothing is touched", async () => {
    for (const p of ["\\\\127.0.0.1\\C$\\x", "//nohost.invalid/share/x", "\\\\?\\C:\\x"]) {
      await expect(resolveWorkspace("a1", p)).rejects.toBeInstanceOf(WorkspaceError);
    }
  });

  test("a folder that cannot be created is a clean error", async () => {
    const file = path.join(home, "a-file");
    fs.writeFileSync(file, "x");
    await expect(resolveWorkspace("a1", path.join(file, "sub"))).rejects.toBeInstanceOf(WorkspaceError);
    const res = workspaceError(new WorkspaceError("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: "nope" } });
  });

  test("create: false creates nothing", async () => {
    const dir = await resolveWorkspace("never-made", "", { create: false });
    expect(fs.existsSync(dir)).toBe(false);
    const custom = path.join(home, "custom", "deep");
    expect(await resolveWorkspace("a1", custom, { create: false })).toBe(custom);
    expect(fs.existsSync(custom)).toBe(false);
  });
});
