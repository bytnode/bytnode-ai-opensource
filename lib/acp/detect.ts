import fs from "node:fs";
import path from "node:path";

/* Un executable deja present sur la machine : parcours du PATH, avec les
   extensions de PATHEXT sous Windows (`gemini.cmd` pose par `npm i -g`).
   Tout est injectable pour les tests ; rien n'est lance. */

type Options = { env?: Record<string, string | undefined>; platform?: NodeJS.Platform; exists?: (p: string) => boolean };

export function findOnPath(name: string, { env = process.env, platform = process.platform, exists = fs.existsSync }: Options = {}): string | null {
  const win = platform === "win32";
  const raw = win ? (env.Path ?? env.PATH ?? "") : (env.PATH ?? "");
  const dirs = raw.split(win ? ";" : ":").filter(Boolean);
  const exts = win ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
  const names = win ? [...exts.map((e) => name + e), name] : [name];
  for (const dir of dirs) {
    for (const n of names) {
      const p = (win ? path.win32 : path.posix).join(dir, n);
      if (exists(p)) return p;
    }
  }
  return null;
}
