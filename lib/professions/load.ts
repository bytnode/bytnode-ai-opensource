import fs from "node:fs/promises";
import path from "node:path";
import type { ProfessionId } from "./catalog";
import { listSkillsIn, type SkillInfo } from "@/lib/tools/skills/skill";

/* ---------------------------------------------------------------------------
   Charger une profession : son prompt, ses competences.

   `professions/<id>/PROMPT.md` est le prompt systeme du metier ;
   `professions/<id>/skills/<nom>/SKILL.md` ses competences propres ;
   `professions/_commun/skills/` celles que tous les metiers partagent
   (la source de donnees, la forme d'une reponse). Tout est du fichier,
   modifiable a la main.
--------------------------------------------------------------------------- */

export type Profession = { id: ProfessionId; prompt: string; skills: SkillInfo[] };

export async function loadProfession(root: string, id: ProfessionId): Promise<Profession> {
  const dir = path.join(root, "professions", id);
  let prompt = "";
  try {
    prompt = (await fs.readFile(path.join(dir, "PROMPT.md"), "utf8")).trim();
  } catch {
    /* pas de prompt : le metier n'ajoute rien */
  }
  const own = await listSkillsIn(path.join(dir, "skills"));
  const shared = await listSkillsIn(path.join(root, "professions", "_commun", "skills"));
  const seen = new Set(own.map((s) => s.name));
  return { id, prompt, skills: [...own, ...shared.filter((s) => !seen.has(s.name))] };
}
