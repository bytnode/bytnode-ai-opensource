import fs from "node:fs";
import path from "node:path";

/* An executable already present on the machine: walk the PATH, with the
   PATHEXT extensions on Windows (`gemini.cmd` put there by `npm i -g`).
   Everything is injectable for the tests; nothing is launched. */

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
