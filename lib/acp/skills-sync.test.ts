import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncSkills } from "./skills-sync";
import type { SkillInfo } from "@/lib/tools/skills/skill";

let root: string;
let workspace: string;
let source: string;

const HOMES = [".agents/skills", ".claude/skills"];

const write = async (dir: string, name: string, body = "instructions") => {
  const d = path.join(dir, name);
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}\n`);
  return { name, description: name, path: path.join(d, "SKILL.md") } satisfies SkillInfo;
};

const read = (rel: string) => fs.readFile(path.join(workspace, rel), "utf8");
const listed = async (home: string) => (await fs.readdir(path.join(workspace, home))).sort();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bytnode-skills-"));
  workspace = path.join(root, "ws");
  source = path.join(root, "src");
  await fs.mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("syncSkills", () => {
  it("drops each skill into the two folders the agents read", async () => {
    const a = await write(source, "funding-analysis");
    await syncSkills(workspace, [a]);
    for (const home of HOMES) {
      expect(await listed(home)).toEqual(["funding-analysis"]);
      expect(await read(`${home}/funding-analysis/SKILL.md`)).toContain("instructions");
    }
  });

  it("copies the whole folder, not only the SKILL.md", async () => {
    const a = await write(source, "with-data");
    await fs.writeFile(path.join(source, "with-data", "example.csv"), "a,b\n1,2\n");
    await syncSkills(workspace, [a]);
    expect(await read(".agents/skills/with-data/example.csv")).toContain("a,b");
  });

  it("does not touch a skill hand-written in the workspace", async () => {
    const mine = path.join(workspace, ".agents", "skills", "mine");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "SKILL.md"), "my own");
    const a = await write(source, "mine");
    await syncSkills(workspace, [a]);
    expect(await read(".agents/skills/mine/SKILL.md")).toBe("my own");
  });

  it("keeps the first on a name collision (the profession before the project)", async () => {
    const profession = await write(path.join(source, "profession"), "duplicate", "profession version");
    const project = await write(path.join(source, "project"), "duplicate", "project version");
    await syncSkills(workspace, [profession, project]);
    expect(await read(".agents/skills/duplicate/SKILL.md")).toContain("profession version");
  });

  it("picks up a modified skill", async () => {
    const a = await write(source, "evolving", "first version");
    await syncSkills(workspace, [a]);
    await fs.writeFile(a.path, `---\nname: evolving\ndescription: evolving\n---\n\nsecond version\n`);
    const later = (Date.now() + 5000) / 1000;
    await fs.utimes(a.path, later, later);
    await syncSkills(workspace, [a]);
    expect(await read(".agents/skills/evolving/SKILL.md")).toContain("second version");
  });

  it("removes the ones no longer provided, and only ours", async () => {
    const a = await write(source, "old");
    await syncSkills(workspace, [a]);
    const mine = path.join(workspace, ".agents", "skills", "mine");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "SKILL.md"), "my own");
    await syncSkills(workspace, []);
    expect(await listed(".agents/skills")).toEqual(["mine"]);
  });
});
