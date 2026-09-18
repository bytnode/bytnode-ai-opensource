import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentsDir } from "@/lib/server/data-dir";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { findOnPath } from "./detect";
import { AGENT_SOURCES, type NpmSource } from "./packages";

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
/** `BYTNODE_AI_IGNORE_PATH` (`npm run vierge`) : ne rien reconnaitre sur le
    PATH, pour voir le systeme comme une machine sans aucun agent. */
const onPath = (name: string) => (process.env.BYTNODE_AI_IGNORE_PATH ? null : findOnPath(name));

export function resolveAcp(agent: AcpAgentId): Resolved | null {
  const src = AGENT_SOURCES[agent];
  if (src.kind === "download") {
    const exe = path.join(agentDir(agent), process.platform === "win32" ? `${src.exe}.exe` : src.exe);
    return fs.existsSync(exe) ? { command: exe, args: [], source: "installed" } : null;
  }
  const local = installed(agent, src.pkg, src.acp.entry);
  if (fs.existsSync(local)) return { command: process.execPath, args: [local, ...src.acp.args], source: "installed" };
  if (src.global) {
    const found = onPath(src.global.command);
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
    const found = onPath(src.global.command);
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
  /* `turbopackIgnore` : sans lui, Turbopack croit devoir tracer tout le
     projet a cause de ce test de chemin dynamique. */
  for (const c of candidates) if (fs.existsSync(/*turbopackIgnore: true*/ c)) return { command: process.execPath, args: [c] };
  if (onPath && process.platform !== "win32") return { command: onPath, args: [] };
  throw new Error("npm introuvable à côté de Node : impossible d'installer l'agent.");
}

const STRIPPED_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "MISTRAL_API_KEY",
];

export function subscriptionEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of STRIPPED_ENV) delete env[k];
  /* Pas de couleurs ni de spinners dans ce qu'on lit. */
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  return env;
}

export function spawnAcp(agent: AcpAgentId, cwd: string): ChildProcess {
  const { command, args } = acpLaunch(agent);
  return spawn(command, args, {
    cwd,
    env: subscriptionEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

/** Lance le CLI du produit et rend sa sortie (stdout + stderr), bornee. */
export function runCli(agent: AcpAgentId, args: string[], timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  const { command, args: base } = cliLaunch(agent);
  return runCommand(command, [...base, ...args], timeoutMs);
}

export function runCommand(command: string, args: string[], timeoutMs = 20_000, opts: { cwd?: string } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: subscriptionEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    const take = (chunk: Buffer) => {
      out += chunk.toString("utf8");
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, out: `${out}\n[délai dépassé]` });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: `${out}\n${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Ouvre une fenetre de terminal qui execute cette commande, et rend la
    main tout de suite : c'est la que l'utilisateur se connecte (l'agent
    ouvre le navigateur, puis attend son retour). */
export function openTerminal(command: string, args: string[], title: string, extraEnv: Record<string, string> = {}): void {
  const full = [command, ...args];
  const env = subscriptionEnv(extraEnv);
  if (process.platform === "win32") {
    /* ⚠️ LIGNE DE COMMANDE ECRITE A LA MAIN (`windowsVerbatimArguments`).
       Laisser Node citer les arguments ajoute des `\"` que cmd.exe ne
       comprend pas : `start` prenait `Claude\"` pour le programme a lancer.
       `start` prend le premier argument entre guillemets comme titre ;
       `cmd /k "…"` retire la premiere et la derniere paire de guillemets,
       d'ou la paire externe autour de la commande complete. */
    const q = (s: string) => `"${s.replace(/"/g, "")}"`;
    const line = `/c start ${q(title)} cmd.exe /k "${full.map(q).join(" ")}"`;
    spawn("cmd.exe", [line], { env, detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: true }).unref();
    return;
  }
  const line = full.map((s) => `'${s.replace(/'/g, `'\\''`)}'`).join(" ");
  if (process.platform === "darwin") {
    spawn("osascript", ["-e", `tell application "Terminal" to do script "${line.replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate'], {
      env,
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  spawn("x-terminal-emulator", ["-e", `sh -c ${JSON.stringify(line)}`], { env, detached: true, stdio: "ignore" }).unref();
}

export function openTerminalWith(agent: AcpAgentId, args: string[], title: string): void {
  const { command, args: base } = cliLaunch(agent);
  openTerminal(command, [...base, ...args], title);
}
