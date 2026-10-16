import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------------------
   « From zero »: the app as a new user gets it, every time (user request,
   2026-10-07: « refaire tout le process de 0 pour vérifier si tout
   fonctionne »). Used by `npm run dev-zero` (`dev-zero.ts`).

   Nothing of the real setup is touched — it is only NOT SEEN, the way
   `npm run vierge` does for the command:
   - the browser's storage (keys, agents, conversations) → a new profile;
   - ~/.bytnode-ai (installed agents, workspaces) → a new data folder;
   - the agents' OWN sign-ins (Claude in ~/.claude, Codex in ~/.codex,
     Copilot, Grok in their folders) → the server and everything it
     starts see a new, empty home folder (`USERPROFILE` / `HOME`), and
     Claude / Codex a config folder of their own (Claude keys its Windows
     credential by that folder);
   - the agents already on the PATH → ignored (`BYTNODE_AI_IGNORE_PATH`).
   Each session lives in the temp folder; the previous ones are removed at
   the next start (a browser profile still open is held and stays).
--------------------------------------------------------------------------- */

export type FreshSession = { root: string; home: string; profile: string; dataDir: string };

/** The server's environment in a session from zero. Pure. */
export function freshEnv(s: FreshSession): Record<string, string> {
  return {
    USERPROFILE: s.home,
    HOME: s.home,
    CLAUDE_CONFIG_DIR: path.join(s.home, ".claude"),
    CODEX_HOME: path.join(s.home, ".codex"),
    BYTNODE_AI_HOME: s.dataDir,
    BYTNODE_AI_IGNORE_PATH: "1",
  };
}

/** A new session folder; the earlier ones go (those still in use stay). */
export function startFresh(base = path.join(os.tmpdir(), "bytnode-ai-from-zero")): FreshSession {
  fs.mkdirSync(base, { recursive: true });
  for (const old of fs.readdirSync(base)) {
    try {
      fs.rmSync(path.join(base, old), { recursive: true, force: true });
    } catch {
      /* held by a session still open */
    }
  }
  const root = fs.mkdtempSync(path.join(base, "session-"));
  const home = path.join(root, "home");
  const s: FreshSession = { root, home, profile: path.join(root, "profile"), dataDir: path.join(home, ".bytnode-ai") };
  /* Codex refuses a CODEX_HOME that does not exist. */
  for (const d of [s.profile, s.dataDir, path.join(home, ".claude"), path.join(home, ".codex")]) fs.mkdirSync(d, { recursive: true });
  return s;
}
