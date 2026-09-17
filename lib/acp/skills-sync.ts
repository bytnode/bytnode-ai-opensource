import fs from "node:fs/promises";
import path from "node:path";
import type { SkillInfo } from "@/lib/tools/skills/skill";

/* Deposer les competences dans le dossier de travail, la ou les agents
   externes les cherchent : `.agents/skills/` (Codex, Gemini, Grok) et
   `.claude/skills/` (Claude Code). Une copie fidele du dossier de chaque
   competence — celles de la profession et celles du dossier `skills/` du
   projet, les votres.

   Idempotent, et JAMAIS par-dessus une competence ecrite a la main dans le
   dossier de travail : on ne remplace que les notres, marquees d'un fichier
   `.bytnode-ai`. En cas de meme nom, la premiere de la liste gagne (la
   profession passe avant le dossier du projet). */

const HOMES = [".agents/skills", ".claude/skills"];
const MARK = ".bytnode-ai";

export async function syncSkills(workspace: string, skills: SkillInfo[]): Promise<void> {
  /* Un seul dossier par nom : la premiere occurrence. */
  const wanted = new Map<string, SkillInfo>();
  for (const s of skills) if (!wanted.has(s.name)) wanted.set(s.name, s);

  for (const home of HOMES) {
    const root = path.join(workspace, ...home.split("/"));
    await fs.mkdir(root, { recursive: true });
    /* Une competence retiree du projet disparait aussi d'ici — sinon un
       agent continuerait de suivre une consigne supprimee. */
    for (const dir of await fs.readdir(root).catch(() => [] as string[])) {
      if (wanted.has(dir)) continue;
      if (await exists(path.join(root, dir, MARK))) await fs.rm(path.join(root, dir), { recursive: true, force: true });
    }
    for (const s of wanted.values()) {
      const src = path.dirname(s.path);
      const dst = path.join(root, s.name);
      const ours = await exists(path.join(dst, MARK));
      if ((await exists(dst)) && !ours) continue;
      if (ours && !(await changed(src, dst))) continue;
      await fs.rm(dst, { recursive: true, force: true });
      await fs.cp(src, dst, { recursive: true });
      await fs.writeFile(path.join(dst, MARK), "Copié par BytNode-AI. Modifiez l'original (professions/ ou skills/).\n");
    }
  }
}

/** Le SKILL.md a-t-il change depuis la copie ? (on evite de reecrire a
    chaque tour de conversation) */
async function changed(src: string, dst: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([fs.stat(path.join(src, "SKILL.md")), fs.stat(path.join(dst, "SKILL.md"))]);
    return a.mtimeMs > b.mtimeMs;
  } catch {
    return true;
  }
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
