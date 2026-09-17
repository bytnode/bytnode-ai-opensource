import { describe, expect, it } from "vitest";
import path from "node:path";
import { agentsDir, dataDir, userSkillsDir, workspacesDir } from "./data-dir";

describe("dataDir", () => {
  it("est ~/.bytnode-ai par defaut", () => {
    expect(dataDir({}, "/home/u")).toBe(path.join("/home/u", ".bytnode-ai"));
  });
  it("se surcharge par BYTNODE_AI_HOME", () => {
    expect(dataDir({ BYTNODE_AI_HOME: "/tmp/bn" }, "/home/u")).toBe(path.resolve("/tmp/bn"));
  });
  it("ignore une variable vide", () => {
    expect(dataDir({ BYTNODE_AI_HOME: "  " }, "/home/u")).toBe(path.join("/home/u", ".bytnode-ai"));
  });
  it("derive les sous-dossiers", () => {
    const env = { BYTNODE_AI_HOME: "/tmp/bn" };
    expect(workspacesDir(env)).toBe(path.resolve("/tmp/bn", "workspaces"));
    expect(userSkillsDir(env)).toBe(path.resolve("/tmp/bn", "skills"));
    expect(agentsDir(env)).toBe(path.resolve("/tmp/bn", "agents"));
  });
});
