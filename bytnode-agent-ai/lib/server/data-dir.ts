import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------------------
   Le dossier des donnees de l'utilisateur : dossiers de travail des agents,
   agents par abonnement installes, competences personnelles.

   Hors du paquet, toujours : installe par `npx`, le paquet vit dans
   `~/.npm/_npx/<hash>/node_modules/bytnode-ai/`, purge sans prevenir et
   remplace a chaque version. `PROJECT_ROOT` ne sert plus qu'au code et aux
   ressources du paquet (professions, lib, node_modules).
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
