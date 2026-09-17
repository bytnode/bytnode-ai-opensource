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

const write = async (dir: string, name: string, body = "consignes") => {
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
  it("depose chaque competence dans les deux dossiers que les agents lisent", async () => {
    const a = await write(source, "analyse-funding");
    await syncSkills(workspace, [a]);
    for (const home of HOMES) {
      expect(await listed(home)).toEqual(["analyse-funding"]);
      expect(await read(`${home}/analyse-funding/SKILL.md`)).toContain("consignes");
    }
  });

  it("copie le dossier entier, pas seulement le SKILL.md", async () => {
    const a = await write(source, "avec-donnees");
    await fs.writeFile(path.join(source, "avec-donnees", "exemple.csv"), "a,b\n1,2\n");
    await syncSkills(workspace, [a]);
    expect(await read(".agents/skills/avec-donnees/exemple.csv")).toContain("a,b");
  });

  it("ne touche pas a une competence ecrite a la main dans le dossier de travail", async () => {
    const mine = path.join(workspace, ".agents", "skills", "la-mienne");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "SKILL.md"), "a moi");
    const a = await write(source, "la-mienne");
    await syncSkills(workspace, [a]);
    expect(await read(".agents/skills/la-mienne/SKILL.md")).toBe("a moi");
  });

  it("garde la premiere en cas de meme nom (la profession avant le projet)", async () => {
    const metier = await write(path.join(source, "metier"), "doublon", "version metier");
    const projet = await write(path.join(source, "projet"), "doublon", "version projet");
    await syncSkills(workspace, [metier, projet]);
    expect(await read(".agents/skills/doublon/SKILL.md")).toContain("version metier");
  });

  it("reprend une competence modifiee", async () => {
    const a = await write(source, "evolutive", "premiere version");
    await syncSkills(workspace, [a]);
    await fs.writeFile(a.path, `---\nname: evolutive\ndescription: evolutive\n---\n\nseconde version\n`);
    const later = (Date.now() + 5000) / 1000;
    await fs.utimes(a.path, later, later);
    await syncSkills(workspace, [a]);
    expect(await read(".agents/skills/evolutive/SKILL.md")).toContain("seconde version");
  });

  it("retire celles qu'on ne fournit plus, et seulement les notres", async () => {
    const a = await write(source, "ancienne");
    await syncSkills(workspace, [a]);
    const mine = path.join(workspace, ".agents", "skills", "la-mienne");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "SKILL.md"), "a moi");
    await syncSkills(workspace, []);
    expect(await listed(".agents/skills")).toEqual(["la-mienne"]);
  });
});
