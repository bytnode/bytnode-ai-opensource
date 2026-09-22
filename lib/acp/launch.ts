import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentsDir } from "@/lib/server/data-dir";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { findOnPath } from "./detect";
import { AGENT_SOURCES, type NpmSource } from "./packages";

/* ---------------------------------------------------------------------------
   Where the agents are, and how we launch them.

   Nothing is bundled: « Install » puts each agent in
   `~/.bytnode-ai/agents/<id>/` (an `npm install` for npm packages, an
   archive from the ACP registry for Mistral — `install.ts`), and the agents
   that speak ACP natively are also recognised if they are already on the
   PATH. The table is in `packages.ts`; here, the resolution on this machine.

   ⚠️ API KEYS ARE STRIPPED FROM THE ENVIRONMENT. An `ANTHROPIC_API_KEY` or
   `OPENAI_API_KEY` left in place would bill the API instead of the
   subscription — exactly what this mode is meant to avoid.
--------------------------------------------------------------------------- */

export const agentDir = (agent: AcpAgentId) => path.join(agentsDir(), agent);

/** `shell` is only ever set by `npmCli`, for Windows' `npm.cmd`. */
type Launch = { command: string; args: string[]; shell?: boolean };
export type Resolved = Launch & { source: "installed" | "global" };

const installed = (agent: AcpAgentId, pkg: string, entry: string[]) => path.join(agentDir(agent), "node_modules", pkg, ...entry);

/** An interrupted npm installation (window closed during the download,
    power cut) leaves a partial `node_modules` — a truncated binary, which
    Windows refuses with `spawn EFTYPE` — and no `package-lock.json`, which
    npm only writes at the end (`--package-lock=true` in `install.ts`, so
    the signal does not depend on the user's .npmrc). We never launch an
    agent in that state: « Install » starts over. */
export function brokenInstall(agent: AcpAgentId, exists: (p: string) => boolean = fs.existsSync): string | null {
  const dir = agentDir(agent);
  if (AGENT_SOURCES[agent].kind !== "npm" || !exists(path.join(dir, "node_modules")) || exists(path.join(dir, "package-lock.json"))) return null;
  return `Incomplete ${acpAgentInfo(agent).label} installation: run Install again.`;
}

/** A global CLI found on the PATH. On Windows, `npm i -g` puts a `.cmd`
    that Node refuses to launch without a shell (CVE-2024-27980): we go back
    to the package's script, next to it, and launch it with this Node. */
function fromGlobal(found: string, src: NpmSource, entry: string[], args: string[]): Launch | null {
  if (process.platform !== "win32") return { command: found, args };
  const script = path.join(path.dirname(found), "node_modules", src.pkg, ...entry);
  return fs.existsSync(script) ? { command: process.execPath, args: [script, ...args] } : null;
}

/** The agent's ACP launch on this machine, or null if it is absent. */
/** `BYTNODE_AI_IGNORE_PATH` (`npm run vierge`): recognise nothing on the
    PATH, to see the system as a machine without any agent. */
const onPath = (name: string) => (process.env.BYTNODE_AI_IGNORE_PATH ? null : findOnPath(name));

export function resolveAcp(agent: AcpAgentId): Resolved | null {
  const src = AGENT_SOURCES[agent];
  if (src.kind === "download") {
    const exe = path.join(agentDir(agent), process.platform === "win32" ? `${src.exe}.exe` : src.exe);
    return fs.existsSync(exe) ? { command: exe, args: [], source: "installed" } : null;
  }
  const local = installed(agent, src.pkg, src.acp.entry);
  if (!brokenInstall(agent) && fs.existsSync(local)) return { command: process.execPath, args: [local, ...src.acp.args], source: "installed" };
  if (src.global) {
    const found = onPath(src.global.command);
    const launch = found && fromGlobal(found, src, src.acp.entry, src.global.args);
    if (launch) return { ...launch, source: "global" };
  }
  return null;
}

export const acpLaunch = (agent: AcpAgentId): Launch => {
  const r = resolveAcp(agent);
  if (!r) throw new Error(`${acpAgentInfo(agent).label} is not installed.`);
  return r;
};

/** Can the agent be launched? (installed by us, or found on the PATH) */
export const isInstalled = (agent: AcpAgentId): boolean => resolveAcp(agent) !== null;

/** The version of the package we installed, or null (absent, or global CLI). */
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

/** The Claude Code CLI of the Agent SDK, inside the adapter's installation.
    Since SDK 0.3 it is a native binary in a per-platform package
    (`@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`…); SDK 0.2
    shipped a `cli.js` to launch with Node. We take whichever is present. */
function claudeCli(): Launch {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const variants =
    process.platform === "linux"
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`];
  for (const v of variants) {
    const bin = installed("claude", `@anthropic-ai/claude-agent-sdk-${v}`, [exe]);
    if (!brokenInstall("claude") && fs.existsSync(bin)) return { command: bin, args: [] };
  }
  return { command: process.execPath, args: [installed("claude", "@anthropic-ai/claude-agent-sdk", ["cli.js"])] };
}

/** The product's own CLI, for signing in to the account and reading its
    state (the agents that have one; the others go through the protocol). */
export function cliLaunch(agent: AcpAgentId): Launch {
  if (agent === "claude") return claudeCli();
  const src = AGENT_SOURCES[agent];
  if (src.kind !== "npm" || !src.cli) throw new Error(`${agent} has no command line of its own.`);
  const local = installed(agent, src.cli.pkg ?? src.pkg, src.cli.entry);
  if (!brokenInstall(agent) && fs.existsSync(local)) return { command: process.execPath, args: [local] };
  if (src.global) {
    const found = onPath(src.global.command);
    const launch = found && fromGlobal(found, src, src.cli.entry, []);
    if (launch) return launch;
  }
  throw new Error(`${acpAgentInfo(agent).label} is not installed.`);
}

type NpmCliOptions = { platform?: NodeJS.Platform; execPath?: string; env?: Record<string, string | undefined>; exists?: (p: string) => boolean };

/** The `npm` shipped with the Node running us, launched by that Node: no
    dependency on the PATH nor on Windows' `npm.cmd`.

    ⚠️ THE SCRIPT IS NOT ALWAYS THERE, AND ITS ABSENCE IS NOT THE ABSENCE
    OF npm. A shim-based install (Volta, nvs, the Microsoft Store, some
    Scoop / Chocolatey layouts) puts a `node.exe` that has no
    `node_modules/npm` beside it — and its `npm` shim has none either, so
    the PATH-derived candidate misses too. This used to throw, which ended
    « Install » on those machines although `npm` worked perfectly in their
    terminal (`bin/bytnode-ai.mjs` has always fallen back that way, which
    is why installing the *command* succeeded and installing an *agent*
    did not). Last resort, therefore: the `npm` command itself. On Windows
    that is `npm.cmd`, which Node refuses to spawn without a shell
    (CVE-2024-27980) — we pass the bare name, never a resolved path, since
    `shell` leaves the command unquoted and `C:\Program Files\…` would
    split. Every argument we pass is a literal from this file. */
export function npmCli({ platform = process.platform, execPath = process.execPath, env = process.env, exists = fs.existsSync }: NpmCliOptions = {}): Launch {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const script = ["node_modules", "npm", "bin", "npm-cli.js"];
  const nodeDir = p.dirname(execPath);
  const candidates = win
    ? [p.join(nodeDir, ...script), ...(env.APPDATA ? [p.join(env.APPDATA, "npm", ...script)] : [])]
    : [p.join(nodeDir, "..", "lib", ...script), p.join(nodeDir, "..", "libexec", "lib", ...script)];
  const onPath = findOnPath("npm", { env, platform, exists });
  if (onPath) candidates.push(p.join(p.dirname(onPath), ...script));
  /* `turbopackIgnore`: without it, Turbopack thinks it has to trace the
     whole project because of this dynamic path check. */
  for (const c of candidates) if (exists(/*turbopackIgnore: true*/ c)) return { command: execPath, args: [c] };
  if (!win && onPath) return { command: onPath, args: [] };
  return { command: "npm", args: [], shell: win };
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
  /* No colours nor spinners in what we read. */
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

/** Runs the product's CLI and returns its output (stdout + stderr), bounded. */
export function runCli(agent: AcpAgentId, args: string[], timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  const { command, args: base } = cliLaunch(agent);
  return runCommand(command, [...base, ...args], timeoutMs);
}

export function runCommand(command: string, args: string[], timeoutMs = 20_000, opts: { cwd?: string; shell?: boolean } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: opts.cwd, shell: opts.shell, env: subscriptionEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    const take = (chunk: Buffer) => {
      out += chunk.toString("utf8");
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, out: `${out}\n[timed out]` });
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

/** Opens a terminal window that runs this command, and returns at once:
    that is where the user signs in (the agent opens the browser, then
    waits for the callback). */
export function openTerminal(command: string, args: string[], title: string, extraEnv: Record<string, string> = {}): void {
  const full = [command, ...args];
  const env = subscriptionEnv(extraEnv);
  if (process.platform === "win32") {
    /* ⚠️ COMMAND LINE WRITTEN BY HAND (`windowsVerbatimArguments`).
       Letting Node quote the arguments adds `\"` that cmd.exe does not
       understand: `start` took `Claude\"` for the program to launch.
       `start` takes the first quoted argument as the title; `cmd /k "…"`
       strips the first and last pair of quotes, hence the outer pair
       around the full command. */
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
