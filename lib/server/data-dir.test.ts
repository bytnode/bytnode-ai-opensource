import { describe, expect, it } from "vitest";
import path from "node:path";
import { agentsDir, dataDir, userSkillsDir, workspacesDir } from "./data-dir";

describe("dataDir", () => {
  it("is ~/.bytnode-ai by default", () => {
    expect(dataDir({}, "/home/u")).toBe(path.join("/home/u", ".bytnode-ai"));
  });
  it("is overridden by BYTNODE_AI_HOME", () => {
    expect(dataDir({ BYTNODE_AI_HOME: "/tmp/bn" }, "/home/u")).toBe(path.resolve("/tmp/bn"));
  });
  it("ignores an empty variable", () => {
    expect(dataDir({ BYTNODE_AI_HOME: "  " }, "/home/u")).toBe(path.join("/home/u", ".bytnode-ai"));
  });
  it("derives the subfolders", () => {
    const env = { BYTNODE_AI_HOME: "/tmp/bn" };
    expect(workspacesDir(env)).toBe(path.resolve("/tmp/bn", "workspaces"));
    expect(userSkillsDir(env)).toBe(path.resolve("/tmp/bn", "skills"));
    expect(agentsDir(env)).toBe(path.resolve("/tmp/bn", "agents"));
  });
});
