import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AcpAgentId } from "./agents";

/* ---------------------------------------------------------------------------
   Ou sont les agents, et comment on les lance.

   Deux familles. Les paquets npm sont des dependances de BytNode-AI : rien
   a installer a part l'application — chacun embarque le vrai produit
   (Claude Code dans le SDK Agent, Codex, Gemini CLI, Copilot CLI, Grok
   Build en binaire par plateforme) et on le lance avec le Node qui fait
   tourner ce serveur. Les binaires telecharges (Mistral Vibe)
   vivent dans `~/.bytnode-ai/agents/<id>/`, poses par `install.ts`.

   ⚠️ LES CLES API SONT RETIREES DE L'ENVIRONNEMENT. Une `ANTHROPIC_API_KEY`
   ou `OPENAI_API_KEY` presente ferait facturer l'API au lieu de
   l'abonnement — exactement ce que ce mode veut eviter.
--------------------------------------------------------------------------- */

const ROOT = process.cwd();
const mod = (...p: string[]) => path.join(ROOT, "node_modules", ...p);

export const AGENTS_HOME = path.join(os.homedir(), ".bytnode-ai", "agents");
export const agentDir = (agent: AcpAgentId) => path.join(AGENTS_HOME, agent);

type Launch = { command: string; args: string[] };

/** Le nom de l'executable d'un agent telecharge, par plateforme. */
const DOWNLOADED_EXE: Partial<Record<AcpAgentId, string>> = {
  mistral: process.platform === "win32" ? "vibe-acp.exe" : "vibe-acp",
};

/** Le lancement ACP (stdio) de chaque agent. */
const ACP_LAUNCH: Record<AcpAgentId, () => Launch> = {
  claude: () => ({ command: process.execPath, args: [mod("@zed-industries", "claude-agent-acp", "dist", "index.js")] }),
  openai: () => ({ command: process.execPath, args: [mod("@agentclientprotocol", "codex-acp", "dist", "index.js")] }),
  gemini: () => ({ command: process.execPath, args: [mod("@google", "gemini-cli", "bundle", "gemini.js"), "--acp"] }),
  copilot: () => ({ command: process.execPath, args: [mod("@github", "copilot", "npm-loader.js"), "--acp"] }),
  grok: () => ({ command: process.execPath, args: [mod("@xai-official", "grok", "bin", "grok"), "agent", "stdio"] }),
  mistral: () => ({ command: path.join(agentDir("mistral"), DOWNLOADED_EXE.mistral!), args: [] }),
};

/** Le CLI du produit lui-meme, pour la connexion au compte et son etat
    (les agents qui en ont un ; les autres passent par le protocole). */
const CLI_LAUNCH: Partial<Record<AcpAgentId, () => Launch>> = {
  claude: () => ({ command: process.execPath, args: [mod("@anthropic-ai", "claude-agent-sdk", "cli.js")] }),
  openai: () => ({ command: process.execPath, args: [mod("@openai", "codex", "bin", "codex.js")] }),
  gemini: () => ({ command: process.execPath, args: [mod("@google", "gemini-cli", "bundle", "gemini.js")] }),
  copilot: () => ({ command: process.execPath, args: [mod("@github", "copilot", "npm-loader.js")] }),
  grok: () => ({ command: process.execPath, args: [mod("@xai-official", "grok", "bin", "grok")] }),
};

export const acpLaunch = (agent: AcpAgentId): Launch => ACP_LAUNCH[agent]();
export const cliLaunch = (agent: AcpAgentId): Launch => {
  const l = CLI_LAUNCH[agent];
  if (!l) throw new Error(`${agent} n'a pas de ligne de commande propre.`);
  return l();
};

/** L'adaptateur est-il present ? (le script ou l'executable existe) */
export function isInstalled(agent: AcpAgentId): boolean {
  const { command, args } = ACP_LAUNCH[agent]();
  const entry = command === process.execPath ? args[0] : command;
  return fs.existsSync(entry);
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

export function runCommand(command: string, args: string[], timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: subscriptionEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
    const q = (s: string) => `"${s}"`;
    /* `start` prend le premier argument entre guillemets comme titre. */
    spawn("cmd.exe", ["/c", "start", q(title), "cmd.exe", "/k", full.map(q).join(" ")], { env, detached: true, stdio: "ignore", windowsHide: false }).unref();
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
