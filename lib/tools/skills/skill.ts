import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userSkillsDir } from "@/lib/server/data-dir";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";

/* ---------------------------------------------------------------------------
   Skills: reusable instructions, in markdown.

   A skill is a `<name>/SKILL.md` folder with a YAML front-matter (`name`,
   `description`). They are looked up, in order: the workspace
   (`.agents/skills`, `skills`), then the account (`~/.bytnode-ai/skills`,
   `~/.agents/skills`). The system prompt lists them; the Skill tool returns
   the body of the one the model wants to follow.
--------------------------------------------------------------------------- */

export type SkillInfo = { name: string; description: string; path: string };

/** The skills YOU write, in `~/.bytnode-ai/skills/` (outside the package,
    which is replaced at every version): seen by the OpenRouter agents, and
    copied into the workspace of the subscription agents. */
export const userSkills = () => listSkillsIn(userSkillsDir());

const roots = (workspace: string) => [
  path.join(workspace, ".agents", "skills"),
  path.join(workspace, "skills"),
  userSkillsDir(),
  path.join(os.homedir(), ".agents", "skills"),
];

export function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: md.slice(m[0].length) };
}

/** The skills of a `<root>/<name>/SKILL.md` folder. */
export async function listSkillsIn(root: string): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const dir of entries) {
    const file = path.join(root, dir, "SKILL.md");
    try {
      const { meta } = parseFrontmatter(await fs.readFile(file, "utf8"));
      out.push({ name: meta.name || dir, description: meta.description ?? "", path: file });
    } catch {
      /* no SKILL.md here */
    }
  }
  return out;
}

/** Every skill visible to an agent: its profession's (passed as `extra`,
    which take priority), then the general folders. */
export async function listSkills(workspace: string, extra: SkillInfo[] = []): Promise<SkillInfo[]> {
  const seen = new Map<string, SkillInfo>();
  for (const s of extra) if (!seen.has(s.name)) seen.set(s.name, s);
  for (const root of roots(workspace)) {
    for (const s of await listSkillsIn(root)) if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

type Args = { name: string };

export const skillTool: Tool<Args> = {
  name: "Skill",
  description:
    "Loads a skill (a reusable set of instructions) by its name and returns its instructions, to follow for the current task. The available skills are listed in the system prompt.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "The name of the skill." } },
    required: ["name"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const skills = await listSkills(ctx.workspace, ctx.professionSkills ?? []);
    const skill = skills.find((s) => s.name === args.name) ?? skills.find((s) => s.name.toLowerCase() === String(args.name).toLowerCase());
    if (!skill) {
      return fail(
        skills.length === 0
          ? "No skill is installed (skills/<name>/SKILL.md folder)."
          : `Skill "${args.name}" not found. Available: ${skills.map((s) => s.name).join(", ")}.`,
      );
    }
    try {
      const { body } = parseFrontmatter(await fs.readFile(skill.path, "utf8"));
      return ok(`# Skill: ${skill.name}\n\n${body.trim()}`);
    } catch (e) {
      return fail(`Could not read ${skill.path}: ${errorText(e)}`);
    }
  },
};
