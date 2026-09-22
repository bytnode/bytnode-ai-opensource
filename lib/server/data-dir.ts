import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------------------
   The user's data folder: the agents' workspaces, installed subscription
   agents, personal skills.

   Outside the package, always: installed by `npx`, the package lives in
   `~/.npm/_npx/<hash>/node_modules/bytnode-ai/`, purged without warning and
   replaced at every version. `PROJECT_ROOT` now only serves the package's
   code and resources (professions, lib, node_modules).
--------------------------------------------------------------------------- */

export const DATA_DIR_ENV = "BYTNODE_AI_HOME";

type Env = Record<string, string | undefined>;

export function dataDir(env: Env = process.env, home: string = os.homedir()): string {
  const set = env[DATA_DIR_ENV]?.trim();
  return set ? path.resolve(set) : path.join(home, ".bytnode-ai");
}

export const workspacesDir = (env?: Env, home?: string) => path.join(dataDir(env, home), "workspaces");
export const userSkillsDir = (env?: Env, home?: string) => path.join(dataDir(env, home), "skills");
export const agentsDir = (env?: Env, home?: string) => path.join(dataDir(env, home), "agents");
