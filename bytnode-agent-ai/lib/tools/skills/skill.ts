import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";

/* ---------------------------------------------------------------------------
   Les competences : des consignes reutilisables, en markdown.

   Une competence est un dossier `<nom>/SKILL.md` avec un en-tete YAML
   (`name`, `description`). On les cherche, dans l'ordre : le dossier de
   travail (`.agents/skills`, `skills`), le projet (`skills`), et le compte
   (`~/.agents/skills`). Le prompt systeme en donne la liste ; l'outil Skill
   rend le corps de celle que le modele veut suivre.
--------------------------------------------------------------------------- */

export type SkillInfo = { name: string; description: string; path: string };

/** Le dossier des competences que VOUS ecrivez, a la racine du projet :
    vu par les agents sur OpenRouter, et recopie dans le dossier de travail
    des agents par abonnement. */
export const PROJECT_SKILLS = "skills";

export const projectSkills = (projectRoot: string) => listSkillsIn(path.join(projectRoot, PROJECT_SKILLS));

const roots = (workspace: string, projectRoot: string) => [
  path.join(workspace, ".agents", "skills"),
  path.join(workspace, "skills"),
  path.join(projectRoot, "skills"),
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

/** Les competences d'un dossier `<root>/<nom>/SKILL.md`. */
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
      /* pas de SKILL.md ici */
    }
  }
  return out;
}

/** Toutes les competences visibles d'un agent : celles de sa profession
    (passees en `extra`, prioritaires), puis les dossiers generaux. */
export async function listSkills(workspace: string, projectRoot: string, extra: SkillInfo[] = []): Promise<SkillInfo[]> {
  const seen = new Map<string, SkillInfo>();
  for (const s of extra) if (!seen.has(s.name)) seen.set(s.name, s);
  for (const root of roots(workspace, projectRoot)) {
    for (const s of await listSkillsIn(root)) if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

type Args = { name: string };

export const skillTool: Tool<Args> = {
  name: "Skill",
  description:
    "Charge une compétence (un mode d'emploi réutilisable) par son nom et rend ses consignes, à suivre pour la tâche en cours. Les compétences disponibles sont listées dans le prompt système.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Le nom de la compétence." } },
    required: ["name"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const skills = await listSkills(ctx.workspace, ctx.projectRoot, ctx.professionSkills ?? []);
    const skill = skills.find((s) => s.name === args.name) ?? skills.find((s) => s.name.toLowerCase() === String(args.name).toLowerCase());
    if (!skill) {
      return fail(
        skills.length === 0
          ? "Aucune compétence n'est installée (dossier skills/<nom>/SKILL.md)."
          : `Compétence « ${args.name} » introuvable. Disponibles : ${skills.map((s) => s.name).join(", ")}.`,
      );
    }
    try {
      const { body } = parseFrontmatter(await fs.readFile(skill.path, "utf8"));
      return ok(`# Compétence : ${skill.name}\n\n${body.trim()}`);
    } catch (e) {
      return fail(`Impossible de lire ${skill.path} : ${errorText(e)}`);
    }
  },
};
