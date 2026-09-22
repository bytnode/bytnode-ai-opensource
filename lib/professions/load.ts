import fs from "node:fs/promises";
import path from "node:path";
import type { ProfessionId } from "./catalog";
import { listSkillsIn, type SkillInfo } from "@/lib/tools/skills/skill";

/* ---------------------------------------------------------------------------
   Loading a profession: its prompt, its skills.

   `professions/<id>/PROMPT.md` is the trade's system prompt;
   `professions/<id>/skills/<name>/SKILL.md` its own skills;
   `professions/_commun/skills/` the ones every trade shares (the data
   source, the shape of an answer). Everything is a file, editable by
   hand.
--------------------------------------------------------------------------- */

export type Profession = { id: ProfessionId; prompt: string; skills: SkillInfo[] };

export async function loadProfession(root: string, id: ProfessionId): Promise<Profession> {
  const dir = path.join(root, "professions", id);
  let prompt = "";
  try {
    prompt = (await fs.readFile(path.join(dir, "PROMPT.md"), "utf8")).trim();
  } catch {
    /* no prompt: the trade adds nothing */
  }
  const own = await listSkillsIn(path.join(dir, "skills"));
  const shared = await listSkillsIn(path.join(root, "professions", "_commun", "skills"));
  const seen = new Set(own.map((s) => s.name));
  return { id, prompt, skills: [...own, ...shared.filter((s) => !seen.has(s.name))] };
}
