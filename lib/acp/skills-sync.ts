import fs from "node:fs/promises";
import path from "node:path";
import type { SkillInfo } from "@/lib/tools/skills/skill";

/* Drop the skills into the workspace, where the external agents look for
   them: `.agents/skills/` (Codex, Gemini, Grok) and `.claude/skills/`
   (Claude Code). A faithful copy of each skill's folder — the profession's
   and those of the project's `skills/` folder, your own.

   Idempotent, and NEVER over a skill hand-written in the workspace: we
   only replace our own, marked with a `.bytnode-ai` file. On a name
   collision, the first of the list wins (the profession comes before the
   project folder). */

const HOMES = [".agents/skills", ".claude/skills"];
const MARK = ".bytnode-ai";

export async function syncSkills(workspace: string, skills: SkillInfo[]): Promise<void> {
  /* One folder per name: the first occurrence. */
  const wanted = new Map<string, SkillInfo>();
  for (const s of skills) if (!wanted.has(s.name)) wanted.set(s.name, s);

  for (const home of HOMES) {
    const root = path.join(workspace, ...home.split("/"));
    await fs.mkdir(root, { recursive: true });
    /* A skill removed from the project disappears from here too —
       otherwise an agent would keep following a deleted instruction. */
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
      await fs.writeFile(path.join(dst, MARK), "Copied by BytNode-AI. Edit the original (professions/ or skills/).\n");
    }
  }
}

/** Has the SKILL.md changed since the copy? (we avoid rewriting at every
    conversation turn) */
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
