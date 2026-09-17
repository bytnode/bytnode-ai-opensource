# Publication npm (`npx bytnode-ai`) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx bytnode-ai` démarre BytNode-AI sur Windows, macOS et Linux, sans rien de la machine de l'auteur dans le paquet ; les six agents par abonnement sont détectés ou installés à la demande.

**Architecture:** Build Next livré dans le paquet (`prepack`), `next start` chez l'utilisateur lancé par `bin/bytnode-ai.mjs` avec `cwd` = dossier du paquet (donc `PROJECT_ROOT = process.cwd()` reste vrai). Données utilisateur dans `~/.bytnode-ai/` (`lib/server/data-dir.ts`). Une table `lib/acp/packages.ts` décrit chaque agent (paquet npm / binaire, lancement, CLI global) ; `launch.ts` résout dans l'ordre installé → PATH ; `install.ts` fait `npm install` dans `~/.bytnode-ai/agents/<id>/`.

**Tech Stack:** Next 16, Node ≥ 20.9, Vitest, tsx (scripts et serveur MCP), npm (`files`, `bin`, `prepack`).

**Spec :** `docs/superpowers/specs/2026-09-17-publication-npm-design.md`. Commandes de contrôle avant chaque commit : `npm run typecheck && npm run lint && npm test`. Commits en français, sans accents, `<domaine> : <resume>`.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| Create `lib/server/data-dir.ts` (+ test) | `dataDir()`, `workspacesDir()`, `userSkillsDir()`, `agentsDir()` |
| Modify `lib/server/workspace.ts` | dossiers de travail dans `~/.bytnode-ai/workspaces/`, reprise de l'existant |
| Modify `lib/acp/prepare.ts` | `_acp` dans le même dossier |
| Modify `lib/tools/skills/skill.ts` | skills utilisateur dans `~/.bytnode-ai/skills/` ; `listSkills(workspace, extra)` |
| Modify `app/api/tools/route.ts`, `lib/tools/agents/workflow.ts`, `lib/acp/sessions.ts` | appels de `listSkills` / `userSkills` ; `BYTNODE_AI_HOME` transmis au serveur MCP |
| Create `lib/acp/packages.ts` (+ test) | la table des agents, `installPackageJson`, `satisfiesCaret` |
| Create `lib/acp/detect.ts` (+ test) | `findOnPath` |
| Modify `lib/acp/agents.ts` | plus de `distribution` ; `source`/`outdated` dans `AcpAuthStatus` |
| Modify `lib/acp/launch.ts` | `resolveAcp`, `acpLaunch`, `cliLaunch`, `isInstalled`, `npmCli`, `runCommand(cwd)` |
| Modify `lib/acp/install.ts` | chemin npm à côté du chemin download |
| Modify `lib/acp/auth.ts` | `source`, `outdated`, message sans `distribution` |
| Modify `components/onboarding/step-auth.tsx`, `components/onboarding/provider-picker.tsx` | « Installer » pour les six, « Mettre à jour », sous-titres |
| Modify `.probe-acp.mjs` | lit `~/.bytnode-ai/agents/` |
| Create `lib/publish/pack-check.ts` (+ test), `scripts/prepack.ts` | contrôle de l'archive |
| Create `bin/bytnode-ai.mjs` | le lanceur |
| Modify `package.json` | nom, bin, files, engines, licence, dépendances |
| Create `LICENSE`, `scripts/smoke-pack.mjs`, `.github/workflows/pack.yml` ; Modify `README.md`, `skills/README.md`, `CLAUDE.md`, `components/onboarding/step-agent.tsx` | docs et preuve |

---

### Task 1 : le dossier des données — `lib/server/data-dir.ts`

**Files:** Create `lib/server/data-dir.ts`, `lib/server/data-dir.test.ts`

- [ ] **Step 1 : test**

```ts
// lib/server/data-dir.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { agentsDir, dataDir, userSkillsDir, workspacesDir } from "./data-dir";

describe("dataDir", () => {
  it("est ~/.bytnode-ai par defaut", () => {
    expect(dataDir({}, "/home/u")).toBe(path.join("/home/u", ".bytnode-ai"));
  });
  it("se surcharge par BYTNODE_AI_HOME", () => {
    expect(dataDir({ BYTNODE_AI_HOME: "/tmp/bn" }, "/home/u")).toBe(path.resolve("/tmp/bn"));
  });
  it("ignore une variable vide", () => {
    expect(dataDir({ BYTNODE_AI_HOME: "  " }, "/home/u")).toBe(path.join("/home/u", ".bytnode-ai"));
  });
  it("derive les sous-dossiers", () => {
    const env = { BYTNODE_AI_HOME: "/tmp/bn" };
    expect(workspacesDir(env)).toBe(path.resolve("/tmp/bn", "workspaces"));
    expect(userSkillsDir(env)).toBe(path.resolve("/tmp/bn", "skills"));
    expect(agentsDir(env)).toBe(path.resolve("/tmp/bn", "agents"));
  });
});
```

- [ ] **Step 2 : `npx vitest run lib/server/data-dir.test.ts` → échec (module absent)**

- [ ] **Step 3 : implémentation**

```ts
// lib/server/data-dir.ts
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

export function dataDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const set = env[DATA_DIR_ENV]?.trim();
  return set ? path.resolve(set) : path.join(home, ".bytnode-ai");
}

export const workspacesDir = (env?: NodeJS.ProcessEnv, home?: string) => path.join(dataDir(env, home), "workspaces");
export const userSkillsDir = (env?: NodeJS.ProcessEnv, home?: string) => path.join(dataDir(env, home), "skills");
export const agentsDir = (env?: NodeJS.ProcessEnv, home?: string) => path.join(dataDir(env, home), "agents");
```

- [ ] **Step 4 : test vert ; commit `donnees : dossier ~/.bytnode-ai (BYTNODE_AI_HOME)`**

---

### Task 2 : dossiers de travail, `_acp`, skills utilisateur

**Files:** Modify `lib/server/workspace.ts`, `lib/acp/prepare.ts:34-38`, `lib/tools/skills/skill.ts:17-31,67-70`, `app/api/tools/route.ts:26`, `lib/tools/agents/workflow.ts:57`, `lib/acp/sessions.ts:477-478,495`, `lib/mcp/finance-server.ts` (appel `listSkills` s'il y en a un), `components/onboarding/step-agent.tsx:171`

- [ ] **Step 1 : `workspace.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { workspacesDir } from "./data-dir";

/* Le dossier de travail d'un agent : celui qu'il a configure, sinon
   `~/.bytnode-ai/workspaces/<id>`. Cree s'il manque. Les anciens
   emplacements dans le projet (`workspaces/<id>`, puis `sandboxes/<id>`,
   dont le mot promettait une isolation que le perimetre « tout le disque »
   ne tenait pas) sont deplaces une fois : le paquet installe par npx est
   remplace a chaque version, rien de l'utilisateur ne doit y rester. */

export const PROJECT_ROOT = process.cwd();

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Deplace un dossier, y compris d'un volume a l'autre (copie puis suppression). */
async function move(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

export async function resolveWorkspace(agentId: string, requested: string | undefined): Promise<string> {
  const safeId = (agentId || "agent").replace(/[^\w.-]/g, "_");
  if (requested?.trim()) {
    const dir = path.resolve(requested.trim());
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(workspacesDir(), safeId);
  if (!(await exists(dir))) {
    for (const legacy of [path.join(PROJECT_ROOT, "workspaces", safeId), path.join(PROJECT_ROOT, "sandboxes", safeId)]) {
      if (await exists(legacy)) {
        await move(legacy, dir);
        break;
      }
    }
  }
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 2 : `prepare.ts` — `scratchWorkspace`**

```ts
import { workspacesDir } from "@/lib/server/data-dir";
// …
export async function scratchWorkspace(): Promise<string> {
  const dir = path.join(workspacesDir(), "_acp");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
```
Retirer l'import de `PROJECT_ROOT` s'il ne sert plus dans ce fichier.

- [ ] **Step 3 : `skill.ts` — les skills utilisateur sortent du projet**

Remplacer les lignes 17-31 par :

```ts
import { userSkillsDir } from "@/lib/server/data-dir";
// (en tete de fichier, avec les autres imports)

/** Les competences que VOUS ecrivez, dans `~/.bytnode-ai/skills/` : vues par
    les agents sur OpenRouter, et recopiees dans le dossier de travail des
    agents par abonnement. */
export const userSkills = () => listSkillsIn(userSkillsDir());

const roots = (workspace: string) => [
  path.join(workspace, ".agents", "skills"),
  path.join(workspace, "skills"),
  userSkillsDir(),
  path.join(os.homedir(), ".agents", "skills"),
];
```

et `listSkills` devient `listSkills(workspace: string, extra: SkillInfo[] = [])` avec `roots(workspace)`. Mettre à jour le commentaire d'en-tête (« le compte (`~/.bytnode-ai/skills`, `~/.agents/skills`) »).

- [ ] **Step 4 : les appelants**

- `app/api/tools/route.ts:26` → `listSkills(workspace, prof.skills)`
- `lib/tools/agents/workflow.ts:57` → `listSkills(ctx.workspace, prof.skills)`
- `lib/acp/sessions.ts:478` et `:495` → `userSkills()` à la place de `projectSkills(PROJECT_ROOT)` ; import `userSkills` au lieu de `projectSkills`.
- `lib/mcp/finance-server.ts` : `grep -n "projectSkills\|listSkills" lib/mcp/finance-server.ts` ; s'il y a un appel, même remplacement. `projectRoot` y reste pour `loadProfession`.
- `components/onboarding/step-agent.tsx:171` : hint → `"Là où l'agent démarre ses commandes et résout les chemins relatifs. Vide : un dossier ~/.bytnode-ai/workspaces/<id>."`

- [ ] **Step 5 : `sessions.ts` — transmettre le dossier des données au serveur MCP**

Dans `mcpServersFor`, ajouter à `env` :

```ts
{ name: "BYTNODE_AI_HOME", value: dataDir() },
```
avec `import { dataDir } from "@/lib/server/data-dir";`. Le serveur MCP lit `process.env`, donc `userSkillsDir()` y donne le même dossier.

- [ ] **Step 6 : `npm run typecheck && npm run lint && npm test` verts ; commit `donnees : dossiers de travail, _acp et skills personnels dans ~/.bytnode-ai`**

---

### Task 3 : la table des agents — `lib/acp/packages.ts`

**Files:** Create `lib/acp/packages.ts`, `lib/acp/packages.test.ts` ; Modify `lib/acp/agents.ts:29-33` (retirer `distribution` du type et des six entrées), `:118-135`

- [ ] **Step 1 : test**

```ts
// lib/acp/packages.test.ts
import { describe, expect, it } from "vitest";
import { AGENT_SOURCES, installPackageJson, satisfiesCaret } from "./packages";

describe("installPackageJson", () => {
  it("epingle le paquet et reprend les overrides", () => {
    const src = AGENT_SOURCES.claude;
    if (src.kind !== "npm") throw new Error("claude est un paquet npm");
    expect(installPackageJson(src)).toEqual({
      private: true,
      dependencies: { "@zed-industries/claude-agent-acp": src.version },
      overrides: { "@anthropic-ai/claude-agent-sdk": "^0.3.270" },
    });
  });
  it("n'ecrit pas d'overrides vides", () => {
    const src = AGENT_SOURCES.gemini;
    if (src.kind !== "npm") throw new Error("gemini est un paquet npm");
    expect(installPackageJson(src)).toEqual({ private: true, dependencies: { "@google/gemini-cli": src.version } });
  });
});

describe("satisfiesCaret", () => {
  it("accepte la meme majeure au-dessus du minimum", () => {
    expect(satisfiesCaret("1.12.0", "^1.11.0")).toBe(true);
    expect(satisfiesCaret("1.11.0", "^1.11.0")).toBe(true);
  });
  it("refuse une version plus basse ou une autre majeure", () => {
    expect(satisfiesCaret("1.10.9", "^1.11.0")).toBe(false);
    expect(satisfiesCaret("2.0.0", "^1.11.0")).toBe(false);
  });
  it("en 0.x, la mineure doit etre la meme", () => {
    expect(satisfiesCaret("0.59.3", "^0.59.0")).toBe(true);
    expect(satisfiesCaret("0.60.0", "^0.59.0")).toBe(false);
  });
  it("tolere un suffixe de preversion sur l'installe", () => {
    expect(satisfiesCaret("1.11.0-beta.1", "^1.11.0")).toBe(false);
    expect(satisfiesCaret("1.12.0-beta.1", "^1.11.0")).toBe(true);
  });
});
```

- [ ] **Step 2 : `npx vitest run lib/acp/packages.test.ts` → échec**

- [ ] **Step 3 : implémentation**

```ts
// lib/acp/packages.ts
import type { AcpAgentId } from "./agents";

/* ---------------------------------------------------------------------------
   D'ou vient chaque agent par abonnement, et comment on le lance.

   Rien n'est embarque dans BytNode-AI : « Installer » pose un paquet npm
   (ou un binaire du registre ACP) dans `~/.bytnode-ai/agents/<id>/`, et
   trois agents qui parlent ACP nativement sont aussi reconnus s'ils sont
   deja sur le PATH (`gemini`, `copilot`, `grok`). Claude et Codex passent
   toujours par leur adaptateur : c'est lui qui embarque le produit.

   Ce fichier est partage navigateur / serveur : rien de Node ici.
--------------------------------------------------------------------------- */

export type NpmSource = {
  kind: "npm";
  pkg: string;
  /** Plage `^x.y.z` : relevee a chaque version de BytNode-AI qui a besoin
      d'un adaptateur plus recent (nouveaux modeles, efforts…). */
  version: string;
  /** Repris dans le package.json d'installation. Le SDK Claude : sans cet
      override, l'adaptateur epingle un SDK 0.2 dont la liste des modeles
      s'arrete a Sonnet/Haiku/Opus. */
  overrides?: Record<string, string>;
  /** Point d'entree ACP, relatif a `node_modules/<pkg>`, et ses arguments. */
  acp: { entry: string[]; args: string[] };
  /** Le CLI du produit (connexion, etat du compte), s'il en a un ; `pkg`
      quand il vit dans un autre paquet (dependance de l'adaptateur). */
  cli?: { pkg?: string; entry: string[] };
  /** Le meme agent, deja installe globalement par l'utilisateur. */
  global?: { command: string; args: string[] };
};

export type DownloadSource = {
  kind: "download";
  registryId: string;
  /** Nom de l'executable (`.exe` ajoute sous Windows). */
  exe: string;
  fallback: Record<string, string>;
};

export type AgentSource = NpmSource | DownloadSource;

const MISTRAL = "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1";

export const AGENT_SOURCES: Record<AcpAgentId, AgentSource> = {
  claude: {
    kind: "npm",
    pkg: "@zed-industries/claude-agent-acp",
    version: "^0.23.1",
    overrides: { "@anthropic-ai/claude-agent-sdk": "^0.3.270" },
    acp: { entry: ["dist", "index.js"], args: [] },
  },
  openai: {
    kind: "npm",
    pkg: "@agentclientprotocol/codex-acp",
    version: "^1.11.0",
    acp: { entry: ["dist", "index.js"], args: [] },
    cli: { pkg: "@openai/codex", entry: ["bin", "codex.js"] },
  },
  gemini: {
    kind: "npm",
    pkg: "@google/gemini-cli",
    version: "^0.59.0",
    acp: { entry: ["bundle", "gemini.js"], args: ["--acp"] },
    cli: { entry: ["bundle", "gemini.js"] },
    global: { command: "gemini", args: ["--acp"] },
  },
  copilot: {
    kind: "npm",
    pkg: "@github/copilot",
    version: "^1.0.83",
    acp: { entry: ["npm-loader.js"], args: ["--acp"] },
    cli: { entry: ["npm-loader.js"] },
    global: { command: "copilot", args: ["--acp"] },
  },
  grok: {
    kind: "npm",
    pkg: "@xai-official/grok",
    version: "^1.0.25",
    acp: { entry: ["bin", "grok"], args: ["agent", "stdio"] },
    cli: { entry: ["bin", "grok"] },
    global: { command: "grok", args: ["agent", "stdio"] },
  },
  mistral: {
    kind: "download",
    registryId: "mistral-vibe",
    exe: "vibe-acp",
    fallback: {
      "windows-x86_64": `${MISTRAL}/vibe-acp-windows-x86_64-2.24.1.zip`,
      "darwin-aarch64": `${MISTRAL}/vibe-acp-darwin-aarch64-2.24.1.tar.gz`,
      "darwin-x86_64": `${MISTRAL}/vibe-acp-darwin-x86_64-2.24.1.tar.gz`,
      "linux-x86_64": `${MISTRAL}/vibe-acp-linux-x86_64-2.24.1.tar.gz`,
      "linux-aarch64": `${MISTRAL}/vibe-acp-linux-aarch64-2.24.1.tar.gz`,
    },
  },
};

/** Le package.json ecrit dans `~/.bytnode-ai/agents/<id>/` avant `npm install`. */
export function installPackageJson(src: NpmSource): { private: true; dependencies: Record<string, string>; overrides?: Record<string, string> } {
  const out: ReturnType<typeof installPackageJson> = { private: true, dependencies: { [src.pkg]: src.version } };
  if (src.overrides && Object.keys(src.overrides).length) out.overrides = src.overrides;
  return out;
}

const parse = (v: string): [number, number, number] | null => {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** `installed` satisfait-il la plage `^a.b.c` ? Le strict necessaire de
    semver (nos plages sont toutes des carets) — une preversion `x.y.z-…`
    compte comme inferieure a `x.y.z`. */
export function satisfiesCaret(installed: string, range: string): boolean {
  const min = parse(range.replace(/^\^/, ""));
  const got = parse(installed);
  if (!min || !got) return false;
  const pre = /^\d+\.\d+\.\d+-/.test(installed);
  const [a, b, c] = min;
  const [x, y, z] = got;
  if (x !== a) return false;
  if (a === 0 && y !== b) return false;
  const cmp = y !== b ? y - b : z - c;
  if (cmp !== 0) return cmp > 0;
  return !pre;
}
```

- [ ] **Step 4 : `agents.ts`** — retirer le champ `distribution` (type + six entrées et son commentaire) ; dans `AcpAuthStatus` ajouter après `available` :

```ts
  /** D'ou vient l'agent : pose par « Installer » dans ~/.bytnode-ai/agents,
      ou un CLI global trouve sur le PATH. */
  source?: "installed" | "global";
  /** La version installee ne satisfait plus la plage attendue par cette
      version de BytNode-AI : « Mettre a jour ». */
  outdated?: boolean;
```

Le typecheck cassera dans `auth.ts`, `install.ts`, `launch.ts`, `step-auth.tsx`, `provider-picker.tsx` : c'est attendu, Tasks 4-6 les reprennent.

- [ ] **Step 5 : `npx vitest run lib/acp/packages.test.ts` vert. Pas de commit (typecheck rouge jusqu'à la Task 6).**

---

### Task 4 : détection sur le PATH — `lib/acp/detect.ts`

**Files:** Create `lib/acp/detect.ts`, `lib/acp/detect.test.ts`

- [ ] **Step 1 : test**

```ts
// lib/acp/detect.test.ts
import { describe, expect, it } from "vitest";
import { findOnPath } from "./detect";

const has = (...files: string[]) => (p: string) => files.includes(p);

describe("findOnPath", () => {
  it("parcourt PATH dans l'ordre sous Unix", () => {
    const found = findOnPath("gemini", { platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, exists: has("/usr/bin/gemini") });
    expect(found).toBe("/usr/bin/gemini");
  });
  it("essaie PATHEXT sous Windows, et le nom nu", () => {
    const env = { Path: "C:\\nodejs;C:\\Users\\u\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.CMD" };
    const exists = has("C:\\Users\\u\\AppData\\Roaming\\npm\\gemini.CMD");
    expect(findOnPath("gemini", { platform: "win32", env, exists })).toBe("C:\\Users\\u\\AppData\\Roaming\\npm\\gemini.CMD");
  });
  it("rend null quand rien ne correspond", () => {
    expect(findOnPath("grok", { platform: "linux", env: { PATH: "/bin" }, exists: () => false })).toBeNull();
  });
  it("ignore un PATH absent", () => {
    expect(findOnPath("grok", { platform: "linux", env: {}, exists: () => true })).toBeNull();
  });
});
```

- [ ] **Step 2 : échec, puis implémentation**

```ts
// lib/acp/detect.ts
import fs from "node:fs";
import path from "node:path";

/* Un executable deja present sur la machine : parcours du PATH, avec les
   extensions de PATHEXT sous Windows (`gemini.cmd` pose par `npm i -g`).
   Tout est injectable pour les tests ; rien n'est lance. */

type Options = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; exists?: (p: string) => boolean };

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
```

- [ ] **Step 3 : `npx vitest run lib/acp/detect.test.ts` vert.**

---

### Task 5 : résolution et installation — `launch.ts`, `install.ts`, `auth.ts`

**Files:** Modify `lib/acp/launch.ts` (tout le haut jusqu'à `STRIPPED_ENV`, `runCommand`), `lib/acp/install.ts`, `lib/acp/auth.ts:52-72`, `.probe-acp.mjs`

- [ ] **Step 1 : `launch.ts` — remplacer les lignes 1-84 (jusqu'à `isInstalled` inclus) par :**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { findOnPath } from "./detect";
import { AGENT_SOURCES, type NpmSource } from "./packages";
import { agentsDir } from "@/lib/server/data-dir";

/* ---------------------------------------------------------------------------
   Ou sont les agents, et comment on les lance.

   Rien n'est embarque : « Installer » pose chaque agent dans
   `~/.bytnode-ai/agents/<id>/` (un `npm install` pour les paquets npm, une
   archive du registre ACP pour Mistral — `install.ts`), et les agents qui
   parlent ACP nativement sont aussi reconnus s'ils sont deja sur le PATH.
   La table est dans `packages.ts` ; ici, la resolution sur cette machine.

   ⚠️ LES CLES API SONT RETIREES DE L'ENVIRONNEMENT. Une `ANTHROPIC_API_KEY`
   ou `OPENAI_API_KEY` presente ferait facturer l'API au lieu de
   l'abonnement — exactement ce que ce mode veut eviter.
--------------------------------------------------------------------------- */

export const agentDir = (agent: AcpAgentId) => path.join(agentsDir(), agent);

type Launch = { command: string; args: string[] };
export type Resolved = Launch & { source: "installed" | "global" };

const installed = (agent: AcpAgentId, pkg: string, entry: string[]) => path.join(agentDir(agent), "node_modules", pkg, ...entry);

/** Un CLI global trouve sur le PATH. Sous Windows, `npm i -g` pose un
    `.cmd` que Node refuse de lancer sans shell (CVE-2024-27980) : on
    remonte au script du paquet, a cote, et on le lance avec ce Node. */
function fromGlobal(found: string, src: NpmSource, entry: string[], args: string[]): Launch | null {
  if (process.platform !== "win32") return { command: found, args };
  const script = path.join(path.dirname(found), "node_modules", src.pkg, ...entry);
  return fs.existsSync(script) ? { command: process.execPath, args: [script, ...args] } : null;
}

/** Le lancement ACP de l'agent sur cette machine, ou null s'il est absent. */
export function resolveAcp(agent: AcpAgentId): Resolved | null {
  const src = AGENT_SOURCES[agent];
  if (src.kind === "download") {
    const exe = path.join(agentDir(agent), process.platform === "win32" ? `${src.exe}.exe` : src.exe);
    return fs.existsSync(exe) ? { command: exe, args: [], source: "installed" } : null;
  }
  const local = installed(agent, src.pkg, src.acp.entry);
  if (fs.existsSync(local)) return { command: process.execPath, args: [local, ...src.acp.args], source: "installed" };
  if (src.global) {
    const found = findOnPath(src.global.command);
    const launch = found && fromGlobal(found, src, src.acp.entry, src.global.args);
    if (launch) return { ...launch, source: "global" };
  }
  return null;
}

export const acpLaunch = (agent: AcpAgentId): Launch => {
  const r = resolveAcp(agent);
  if (!r) throw new Error(`${acpAgentInfo(agent).label} n'est pas installé.`);
  return r;
};

/** L'agent est-il lancable ? (installe par nous, ou trouve sur le PATH) */
export const isInstalled = (agent: AcpAgentId): boolean => resolveAcp(agent) !== null;

/** La version du paquet installe par nous, ou null (absent, ou CLI global). */
export function installedVersion(agent: AcpAgentId): string | null {
  const src = AGENT_SOURCES[agent];
  if (src.kind !== "npm") return null;
  try {
    const json = JSON.parse(fs.readFileSync(installed(agent, src.pkg, ["package.json"]), "utf8")) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

/** Le CLI Claude Code du SDK Agent, dans l'installation de l'adaptateur.
    Depuis le SDK 0.3, c'est un binaire natif dans un paquet par plateforme
    (`@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`…) ; le SDK 0.2
    embarquait un `cli.js` a lancer avec Node. On prend ce qui est present. */
function claudeCli(): Launch {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const variants =
    process.platform === "linux"
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`];
  for (const v of variants) {
    const bin = installed("claude", `@anthropic-ai/claude-agent-sdk-${v}`, [exe]);
    if (fs.existsSync(bin)) return { command: bin, args: [] };
  }
  return { command: process.execPath, args: [installed("claude", "@anthropic-ai/claude-agent-sdk", ["cli.js"])] };
}

/** Le CLI du produit lui-meme, pour la connexion au compte et son etat
    (les agents qui en ont un ; les autres passent par le protocole). */
export function cliLaunch(agent: AcpAgentId): Launch {
  if (agent === "claude") return claudeCli();
  const src = AGENT_SOURCES[agent];
  if (src.kind !== "npm" || !src.cli) throw new Error(`${agent} n'a pas de ligne de commande propre.`);
  const local = installed(agent, src.cli.pkg ?? src.pkg, src.cli.entry);
  if (fs.existsSync(local)) return { command: process.execPath, args: [local] };
  if (src.global) {
    const found = findOnPath(src.global.command);
    const launch = found && fromGlobal(found, src, src.cli.entry, []);
    if (launch) return launch;
  }
  throw new Error(`${acpAgentInfo(agent).label} n'est pas installé.`);
}

/** Le `npm` livre avec le Node qui nous execute, lance par ce Node : pas
    de dependance au PATH ni au `npm.cmd` de Windows. */
export function npmCli(): Launch {
  const nodeDir = path.dirname(process.execPath);
  const candidates =
    process.platform === "win32"
      ? [path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")]
      : [path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")];
  const onPath = findOnPath("npm");
  if (onPath) candidates.push(path.join(path.dirname(onPath), "node_modules", "npm", "bin", "npm-cli.js"));
  for (const c of candidates) if (fs.existsSync(c)) return { command: process.execPath, args: [c] };
  if (onPath && process.platform !== "win32") return { command: onPath, args: [] };
  throw new Error("npm introuvable à côté de Node : impossible d'installer l'agent.");
}
```

Puis dans `runCommand`, ajouter un paramètre `opts: { cwd?: string } = {}` et passer `cwd: opts.cwd` au `spawn` :

```ts
export function runCommand(command: string, args: string[], timeoutMs = 20_000, opts: { cwd?: string } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: subscriptionEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
```

Retirer `import os from "node:os"` s'il ne sert plus. `AGENTS_HOME` disparaît : `grep -rn AGENTS_HOME lib app components` doit être vide.

- [ ] **Step 2 : `install.ts`** — retirer `SOURCES` (la table est dans `packages.ts`) ; `archiveUrl` lit `AGENT_SOURCES[agent]` (`kind === "download"`, sinon erreur) avec `src.registryId` et `src.fallback[key]` ; `installAgent` branche :

```ts
import { AGENT_SOURCES, installPackageJson, type NpmSource } from "./packages";
import { agentDir, npmCli, runCommand } from "./launch";
// …
export function installAgent(agent: AcpAgentId): Promise<void> {
  const running = installing.get(agent);
  if (running) return running;
  failures.delete(agent);
  const src = AGENT_SOURCES[agent];
  const p = src.kind === "npm" ? installNpm(agent, src) : installDownload(agent);
  installing.set(agent, p);
  p.catch((e) => failures.set(agent, e instanceof Error ? e.message : String(e))).finally(() => installing.delete(agent));
  return p;
}

/* Un `npm install` dans `~/.bytnode-ai/agents/<id>/`, sur un package.json
   ecrit par nous : c'est la que l'override du SDK Claude s'applique. Le
   meme chemin sert a « Mettre a jour » (la plage a ete relevee). */
async function installNpm(agent: AcpAgentId, src: NpmSource): Promise<void> {
  const dir = agentDir(agent);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(installPackageJson(src), null, 2) + "\n");
  const npm = npmCli();
  const r = await runCommand(npm.command, [...npm.args, "install", "--no-audit", "--no-fund", "--loglevel=error"], 15 * 60_000, { cwd: dir });
  if (r.code !== 0) throw new Error(`npm install a échoué : ${r.out.trim().slice(-300)}`);
}

async function installDownload(agent: AcpAgentId): Promise<void> {
  // le corps actuel de installAgent (archiveUrl, telechargement, extract, chmod), inchange
}
```

L'en-tête du fichier devient « Installer un agent : paquet npm ou binaire du registre ACP ».

- [ ] **Step 3 : `auth.ts:52-72`**

```ts
export async function authStatus(agent: AcpAgentId): Promise<AcpAuthStatus> {
  const resolved = resolveAcp(agent);
  if (!resolved) {
    return { agent, available: false, installing: isInstalling(agent), loggedIn: false, message: installFailure(agent) };
  }
  const base = await (STATUS[agent] ?? genericStatus(agent))();
  const status: AcpAuthStatus = { agent, available: true, source: resolved.source, outdated: isOutdated(agent), ...base };
  if (status.loggedIn) connecting.delete(agent);
  else status.connecting = isConnecting(agent);
  return status;
}

const isOutdated = (agent: AcpAgentId): boolean => {
  const src = AGENT_SOURCES[agent];
  const got = installedVersion(agent);
  return src.kind === "npm" && got !== null && !satisfiesCaret(got, src.version);
};
```
Imports : `resolveAcp`, `installedVersion` depuis `./launch` (à la place de `isInstalled`), `AGENT_SOURCES`, `satisfiesCaret` depuis `./packages` ; `acpAgentInfo` retiré s'il ne sert plus ici.

- [ ] **Step 4 : `.probe-acp.mjs`** — `root` devient `path.join(os.homedir(), ".bytnode-ai", "agents")`, `L` = `{ copilot: [path.join(root, "copilot/node_modules/@github/copilot/npm-loader.js"), "--acp"], grok: [path.join(root, "grok/node_modules/@xai-official/grok/bin/grok"), "agent", "stdio"], gemini: [path.join(root, "gemini/node_modules/@google/gemini-cli/bundle/gemini.js"), "--acp"] }` (qwen retiré, `QWEN_API_KEY` retiré de la liste), `cwd` = `path.join(os.homedir(), ".bytnode-ai", "workspaces", "_acp")` (créé avec `fs.mkdirSync(cwd, { recursive: true })`).

- [ ] **Step 5 : `npm run typecheck`** — il ne doit rester que les erreurs de `step-auth.tsx` / `provider-picker.tsx` (`distribution`). Task 6.

---

### Task 6 : l'interface — « Installer » pour les six, « Mettre à jour »

**Files:** Modify `components/onboarding/step-auth.tsx:106-142`, `components/onboarding/provider-picker.tsx:97`

- [ ] **Step 1 : `step-auth.tsx`** — le sous-titre et les boutons :

```tsx
                <span className="sub-desc">
                  {loading
                    ? "Lecture…"
                    : s.installing
                      ? `Installation de ${a.product}… (quelques minutes)`
                      : !s.available
                        ? (s.message ?? `${a.plan} · via ${a.product}, à installer`)
                        : s.loggedIn
                          ? `Connecté${s.account ? ` · ${s.account}` : ""}${s.source === "global" ? " · CLI détecté" : ""}`
                          : s.connecting
                            ? "Connexion en cours — terminez dans la fenêtre ouverte, puis revenez ici."
                            : `${a.plan} · via ${a.product}${s.source === "global" ? " (détecté sur cette machine)" : ""}`}
                </span>
              </div>
              {!s.available ? (
                <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing || loading} onClick={() => void install(a.id)}>
                  {busy === a.id || s.installing ? <Spinner /> : null}
                  {s.installing ? "Installation" : "Installer"}
                </button>
              ) : (
                <>
                  {s.outdated ? (
                    <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing} onClick={() => void install(a.id)}>
                      {busy === a.id || s.installing ? <Spinner /> : null}
                      {s.installing ? "Mise à jour" : "Mettre à jour"}
                    </button>
                  ) : null}
                  {s.loggedIn ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy === a.id} onClick={() => void logout(a.id)}>
                      {busy === a.id ? <Spinner /> : null}
                      Se déconnecter
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === a.id || loading} onClick={() => void login(a.id)}>
                      {busy === a.id || s.connecting ? <Spinner /> : null}
                      {s.connecting ? "En attente" : "Se connecter"}
                    </button>
                  )}
                </>
              )}
```

et le `field-hint` final : « … Aucune clé n'est créée : c'est votre abonnement qui est utilisé, avec ses limites habituelles. Les agents absents s'installent dans ~/.bytnode-ai/agents au premier clic ; un agent déjà installé sur la machine est reconnu. »

- [ ] **Step 2 : `provider-picker.tsx:97`** → `const toInstall = !!st && !st.available;` et, quelques lignes plus bas, le libellé `Téléchargement de ${a.product}…` → `Installation de ${a.product}…`.

- [ ] **Step 3 : `npm run typecheck && npm run lint && npm test` verts.** Vérification manuelle dans l'app (`npm run dev` tourne déjà chez l'utilisateur) : Réglages → Auth → les six agents avec « Installer » ; cliquer « Installer » sur Gemini → `~/.bytnode-ai/agents/gemini/node_modules/@google/gemini-cli` apparaît, puis « Se connecter ».

- [ ] **Step 4 : commit `acp : agents detectes sur le PATH ou installes a la demande dans ~/.bytnode-ai/agents (table packages.ts, plus rien d'embarque)`**

---

### Task 7 : `package.json` — dépendances, `files`, `bin`, `prepack`

**Files:** Modify `package.json`, `package-lock.json` (par npm)

- [ ] **Step 1 : retirer les paquets d'agents**

```bash
npm uninstall @qwen-code/qwen-code @zed-industries/claude-agent-acp @agentclientprotocol/codex-acp @google/gemini-cli @github/copilot @xai-official/grok
```
Puis retirer le bloc `"overrides"` de `package.json` (il vit dans `packages.ts`), et `npm install` pour que le lock suive. `grep -rn "claude-agent-acp\|codex-acp\|gemini-cli\|@github/copilot\|@xai-official" lib app components --include=*.ts --include=*.tsx` ne doit trouver que `packages.ts`.

- [ ] **Step 2 : les champs de publication** — dans `package.json` :

```jsonc
  "name": "bytnode-ai",
  "version": "0.1.0",
  "description": "Des agents IA financiers, en local : professions, outils, donnees de marche BytNode, modeles par cle OpenRouter ou par abonnement (ACP).",
  "license": "MIT",
  "repository": "github:benjfrem07/bytnode-ai",
  "bin": { "bytnode-ai": "bin/bytnode-ai.mjs" },
  "engines": { "node": ">=20.9" },
  "files": ["bin", ".next", "lib", "professions", "types", "tsconfig.json", "next.config.ts", "proxy.ts"],
  "scripts": {
    "dev": "next dev --port 3777",
    "build": "next build",
    "start": "next start --port 3777",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepack": "tsx scripts/prepack.ts",
    "smoke:pack": "node scripts/smoke-pack.mjs"
  },
```
`"private": true` est retiré (sinon npm refuse de publier).

- [ ] **Step 3 : `npm run typecheck && npm test` verts (rien ne dépend des paquets retirés) ; commit `paquet : bytnode-ai publiable (bin, files, engines, MIT), agents retires des dependances`**

---

### Task 8 : le contrôle de l'archive — `lib/publish/pack-check.ts`, `scripts/prepack.ts`

**Files:** Create `lib/publish/pack-check.ts`, `lib/publish/pack-check.test.ts`, `scripts/prepack.ts`

- [ ] **Step 1 : test**

```ts
// lib/publish/pack-check.test.ts
import { describe, expect, it } from "vitest";
import { forbiddenPaths, leakedSecrets } from "./pack-check";

describe("forbiddenPaths", () => {
  it("refuse les fichiers d'environnement, les donnees et les cles MCP", () => {
    expect(forbiddenPaths([".env.local", "workspaces/a/x.txt", "sandboxes/b", ".mcp.json", "scratchpad/t.mts", "lib/.env"])).toEqual([
      ".env.local",
      "workspaces/a/x.txt",
      "sandboxes/b",
      ".mcp.json",
      "scratchpad/t.mts",
      "lib/.env",
    ]);
  });
  it("laisse passer le paquet", () => {
    expect(forbiddenPaths(["bin/bytnode-ai.mjs", ".next/BUILD_ID", "lib/mcp/finance-server.ts", "professions/standard/PROMPT.md", "README.md"])).toEqual([]);
  });
});

describe("leakedSecrets", () => {
  it("nomme les fichiers qui contiennent une cle", () => {
    const files = [
      { path: "lib/a.ts", text: "const k = 'cb_live_abcdefghijklmnop';" },
      { path: "lib/b.ts", text: "fetch(url, { headers: { Authorization: 'Bearer sk-or-v1-0123456789abcdef' } })" },
      { path: "lib/c.ts", text: "const prefix = 'cb_live_';" },
    ];
    expect(leakedSecrets(files)).toEqual(["lib/a.ts", "lib/b.ts"]);
  });
});
```

- [ ] **Step 2 : échec, puis implémentation**

```ts
// lib/publish/pack-check.ts
/* Ce qui ne doit jamais partir sur npm. `scripts/prepack.ts` passe la liste
   des fichiers de l'archive (npm pack --dry-run --json) par ici et refuse
   la publication au moindre resultat. Pur : testable sans archive. */

const FORBIDDEN = [/(^|\/)\.env/, /^workspaces\//, /^sandboxes(\/|$)/, /^\.mcp\.json$/, /^scratchpad\//];

/** Les motifs d'une cle reelle : le prefixe seul (`cb_live_` dans un
    message) ne compte pas, il faut le corps. */
const SECRETS = [/cb_(live|test)_[A-Za-z0-9]{8,}/, /sk-or-v1-[A-Za-z0-9]{8,}/];

export const forbiddenPaths = (paths: string[]): string[] => paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));

export const leakedSecrets = (files: { path: string; text: string }[]): string[] =>
  files.filter((f) => SECRETS.some((re) => re.test(f.text))).map((f) => f.path);

/** Les fichiers dont on lit le texte pour chercher une cle. */
export const isTextFile = (p: string) => /\.(ts|tsx|js|mjs|cjs|json|md|txt|css|yml|yaml)$/.test(p);
```

- [ ] **Step 3 : `scripts/prepack.ts`**

```ts
/* Avant `npm publish` / `npm pack` : build propre, cache retire, archive
   controlee. Refuse de publier si un fichier interdit ou une cle y figure.
   `--ignore-scripts` sur le `npm pack` interne : sinon prepack se relance. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { forbiddenPaths, isTextFile, leakedSecrets } from "../lib/publish/pack-check";

const root = process.cwd();
const run = (cmd: string, args: string[], quiet = false) => {
  const r = spawnSync(process.execPath, [cmd, ...args], { cwd: root, stdio: quiet ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`prepack : \`${path.basename(cmd)} ${args.join(" ")}\` a échoué (${r.status}).`);
    process.exit(1);
  }
  return r.stdout ?? "";
};

fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });
run(path.join(root, "node_modules", "next", "dist", "bin", "next"), ["build"]);
fs.rmSync(path.join(root, ".next", "cache"), { recursive: true, force: true });

const npm = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (npm.status !== 0) {
  console.error("prepack : npm pack --dry-run a échoué.\n" + npm.stderr);
  process.exit(1);
}
const [pack] = JSON.parse(npm.stdout) as { files: { path: string; size: number }[]; size: number; unpackedSize: number }[];
const paths = pack.files.map((f) => f.path);

const bad = forbiddenPaths(paths);
const leaks = leakedSecrets(paths.filter(isTextFile).map((p) => ({ path: p, text: fs.readFileSync(path.join(root, p), "utf8") })));
if (bad.length || leaks.length) {
  console.error("prepack : PUBLICATION REFUSÉE.");
  for (const p of bad) console.error(`  fichier interdit : ${p}`);
  for (const p of leaks) console.error(`  clé détectée dans : ${p}`);
  process.exit(1);
}
console.log(`prepack : ${paths.length} fichiers, ${(pack.size / 1e6).toFixed(1)} Mo compressés, ${(pack.unpackedSize / 1e6).toFixed(1)} Mo décompressés — archive propre.`);
```

- [ ] **Step 4 : `npx vitest run lib/publish` vert ; `npm run typecheck && npm run lint` verts.** Exécuter `npm pack --dry-run` (déclenche `prepack` : build ~1-2 min, puis le résumé) ; noter la taille. Ne pas commiter le `.tgz` s'il en reste un (`--dry-run` n'en écrit pas).

- [ ] **Step 5 : commit `paquet : prepack (build propre, cache retire, archive controlee — fichiers interdits et cles)`**

---

### Task 9 : le lanceur — `bin/bytnode-ai.mjs`

**Files:** Create `bin/bytnode-ai.mjs`

- [ ] **Step 1 : le script**

```js
#!/usr/bin/env node
/* Le lanceur de `npx bytnode-ai` : verifie Node, trouve un port, demarre
   `next start` DANS LE DOSSIER DU PAQUET (PROJECT_ROOT = process.cwd()
   partout dans l'app), attend que le serveur reponde, ouvre le navigateur.
   Node pur, sans dependance : ce fichier tourne avant tout le reste. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = require(path.join(pkgDir, "package.json"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--version") || flag("-v")) {
  console.log(version);
  process.exit(0);
}
if (flag("--help") || flag("-h")) {
  console.log(`bytnode-ai ${version}\n\n  npx bytnode-ai [--port 3777] [--no-open]\n\n  --port N     port du serveur local (defaut 3777)\n  --no-open    ne pas ouvrir le navigateur\n\nDonnees : ~/.bytnode-ai (BYTNODE_AI_HOME pour changer).`);
  process.exit(0);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`Node 20.9 ou plus est requis (vous avez ${process.versions.node}). https://nodejs.org`);
  process.exit(1);
}

const port = Number(value("--port", "3777"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Port invalide : ${value("--port", "")}`);
  process.exit(1);
}

const free = await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
});
if (!free) {
  console.error(`Le port ${port} est occupé. Relancez avec --port ${port + 1}.`);
  process.exit(1);
}

console.log(`BytNode-AI ${version}`);
const next = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
const child = spawn(process.execPath, [next, "start", "--port", String(port)], {
  cwd: pkgDir,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

const url = `http://localhost:${port}`;
const deadline = Date.now() + 60_000;
let up = false;
while (!up && Date.now() < deadline && child.exitCode === null) {
  try {
    up = (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!up) {
  console.error(`Le serveur ne répond pas sur ${url}.`);
} else if (!flag("--no-open")) {
  const open =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(open[0], open[1], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  console.log(`Ouvert : ${url}   (Ctrl-C pour arrêter)`);
} else console.log(`Prêt : ${url}   (Ctrl-C pour arrêter)`);
```

- [ ] **Step 2 : `npm run lint` vert** (si eslint se plaint des globals Node dans `bin/`, ajouter au `eslint.config.mjs` une entrée `{ files: ["bin/**/*.mjs", "scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", AbortSignal: "readonly", setTimeout: "readonly" } } }`).

- [ ] **Step 3 : essai local** — `npm run build` puis `node bin/bytnode-ai.mjs --port 3790 --no-open` ; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3790/` → `200` ; Ctrl-C arrête tout (`netstat -ano | findstr 3790` vide).

- [ ] **Step 4 : commit `paquet : bin/bytnode-ai.mjs (next start dans le dossier du paquet, port, navigateur)`**

---

### Task 10 : le test bout en bout et la matrice trois OS

**Files:** Create `scripts/smoke-pack.mjs`, `.github/workflows/pack.yml`

- [ ] **Step 1 : `scripts/smoke-pack.mjs`**

```js
/* Le paquet, tel qu'un utilisateur le recoit : `npm pack`, installation du
   .tgz dans un dossier temporaire, `bytnode-ai --no-open`, puis les trois
   verifications qui comptent — la page repond, les professions se chargent
   depuis le paquet, le dossier des donnees est celui de BYTNODE_AI_HOME.
   Sans cle ni agent : zero jeton. `npm run smoke:pack`. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const shell = process.platform === "win32";
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", shell });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} : code ${r.status}`);
  return r.stdout.trim();
};

const tgz = path.join(root, sh("npm", ["pack", "--json"], root).match(/"filename":\s*"([^"]+)"/)[1]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bytnode-ai-smoke-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home);
try {
  sh("npm", ["init", "-y"], tmp);
  sh("npm", ["install", "--no-audit", "--no-fund", tgz], tmp);
  const bin = path.join(tmp, "node_modules", "bytnode-ai", "bin", "bytnode-ai.mjs");
  const port = 3790 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, [bin, "--port", String(port), "--no-open"], { stdio: "inherit", env: { ...process.env, BYTNODE_AI_HOME: home } });
  try {
    const url = `http://localhost:${port}`;
    const deadline = Date.now() + 90_000;
    let ok = false;
    while (!ok && Date.now() < deadline) {
      try {
        ok = (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ok) throw new Error("la page ne répond pas");
    const tools = await fetch(`${url}/api/tools?profession=standard`, { headers: { "Sec-Fetch-Site": "none" } });
    if (!tools.ok) throw new Error(`/api/tools : ${tools.status}`);
    const body = await tools.json();
    if (!JSON.stringify(body).includes("Skill")) throw new Error("/api/tools ne liste pas les outils");
    if (!fs.existsSync(path.join(home, "workspaces"))) throw new Error("BYTNODE_AI_HOME n'a pas été utilisé");
    console.log(`smoke : OK (${path.basename(tgz)}, port ${port}, données dans ${home})`);
  } finally {
    child.kill();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
}
```

Vérifier avant d'écrire la 3ᵉ assertion ce que `GET /api/tools` attend réellement (`sed -n 1,40p app/api/tools/route.ts` : paramètres de requête, en-têtes) et adapter l'URL/le test du corps à ce qu'il renvoie ; le `resolveWorkspace` qu'il appelle crée `workspaces/` sous `BYTNODE_AI_HOME`, c'est la preuve attendue.

- [ ] **Step 2 : `.github/workflows/pack.yml`**

```yaml
name: paquet
on: [push, pull_request]
jobs:
  smoke:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run smoke:pack
```

- [ ] **Step 3 : `npm run smoke:pack` en local → `smoke : OK …`.** Commit `paquet : smoke-pack (installation du .tgz dans un dossier temporaire) et matrice ubuntu/macos/windows`

---

### Task 11 : licence et documentation

**Files:** Create `LICENSE` ; Modify `README.md` (en tête, section « Lancer », ligne 179), `skills/README.md`, `CLAUDE.md`

- [ ] **Step 1 : `LICENSE`** — texte MIT standard, `Copyright (c) 2026 BytNode`.

- [ ] **Step 2 : `README.md`** — remplacer la section « Lancer » par :

````markdown
## Installer

```bash
npx bytnode-ai        # démarre http://localhost:3777 et ouvre le navigateur
```

Prérequis : Node ≥ 20.9. Optionnels : Python + pandas (outil Backtest), `zenity` sous Linux
(sélecteur de dossier). Les données — dossiers de travail, agents par abonnement, compétences
personnelles — vivent dans `~/.bytnode-ai/` (`BYTNODE_AI_HOME` pour changer) ; les clés et les
conversations dans le `localStorage` du navigateur. Mise à jour : `npx bytnode-ai@latest`.
Options : `--port N`, `--no-open`.

Les six agents par abonnement ne sont pas embarqués : un agent déjà installé sur la machine
(`gemini`, `copilot`, `grok`) est reconnu ; les autres s'installent au premier clic sur
« Installer », dans `~/.bytnode-ai/agents/<id>/`.

## Développer

```bash
npm install
npm run dev        # http://localhost:3777 (le port 3000 est laissé libre)
```
````
(garder le paragraphe existant sur l'assistant de premier lancement et le bloc `npm test` … `npm run build`, y ajouter `npm run smoke:pack  # le paquet tel qu'un utilisateur le reçoit`). Ligne 179 : `workspaces/<id>` → `~/.bytnode-ai/workspaces/<id>`. Dans « Par abonnement (ACP) » : remplacer « Cinq agents sont des dépendances npm … rien d'autre à installer » par « Cinq agents sont des paquets npm installés à la demande dans `~/.bytnode-ai/agents/<id>/` (`lib/acp/install.ts`), ou reconnus s'ils sont déjà sur le PATH (`lib/acp/detect.ts`) ; Mistral Vibe est un binaire … ».

- [ ] **Step 3 : `skills/README.md`** — en tête : « Vos propres compétences vont dans `~/.bytnode-ai/skills/<nom>/SKILL.md` (ce dossier du dépôt n'est plus lu ; il documente le format). »

- [ ] **Step 4 : `CLAUDE.md`** — dans « Commands » ajouter `npm run smoke:pack` et `npm pack --dry-run  # prepack : build + contrôle de l'archive` ; dans « Constraints » : « Le paquet npm : `files` est une liste blanche, `prepack` refuse une archive qui contient `.env*`, `workspaces/`, `sandboxes/` ou une clé ; les données utilisateur sont dans `~/.bytnode-ai/` (`lib/server/data-dir.ts`), jamais dans le projet. » ; dans « Subscription agents (ACP) » : remplacer la phrase sur les dépendances npm par la résolution `~/.bytnode-ai/agents/<id>` → PATH (`packages.ts`, `detect.ts`), et « Bump that override » → « relever `overrides` dans `packages.ts` (l'utilisateur voit « Mettre à jour ») ». Retirer la mention de `@qwen-code`.

- [ ] **Step 5 : commit `doc : installation par npx, donnees dans ~/.bytnode-ai, licence MIT`**

---

### Task 12 : contrôle final

- [ ] `npm run typecheck && npm run lint && npm test` verts.
- [ ] `npm run smoke:pack` → OK ; noter la taille imprimée par `prepack`.
- [ ] Dans l'app en dev : Réglages → Auth : les six agents ; « Installer » sur un agent npm puis « Se connecter » ; un agent dont le dossier de travail était `workspaces/<id>` dans le projet retrouve ses fichiers dans `~/.bytnode-ai/workspaces/<id>`.
- [ ] Pousser ; vérifier la matrice GitHub (trois OS verts).
- [ ] Publication (auteur) : `npm login`, `npm publish`, puis `npx bytnode-ai@0.1.0` depuis un dossier vide.

## Auto-revue

- Couverture de la spec : §1 (package.json, prepack, bin) → Tasks 7-9 ; §2 (données) → Tasks 1-2 ; §3 (table, résolution, install npm, outdated, UI) → Tasks 3-6 ; §4 (tests, smoke, matrice, docs, publication) → Tasks 8, 10-12.
- Noms cohérents : `dataDir/workspacesDir/userSkillsDir/agentsDir` (T1) utilisés en T2/T5 ; `AGENT_SOURCES/NpmSource/installPackageJson/satisfiesCaret` (T3) en T5 ; `findOnPath` (T4) en T5 ; `resolveAcp/installedVersion/npmCli/runCommand(cwd)` (T5) en T5 install/auth ; `source/outdated` (T3) en T5/T6 ; `forbiddenPaths/leakedSecrets/isTextFile` (T8).
