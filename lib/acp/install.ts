import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { agentDir, brokenInstall, npmCli, runCommand } from "./launch";
import { AGENT_SOURCES, installPackageJson, type NpmSource } from "./packages";

/* ---------------------------------------------------------------------------
   Install a subscription agent into `~/.bytnode-ai/agents/<id>/`.

   Two paths, according to `packages.ts`. An npm package: we write a
   package.json (pinned dependency, overrides) and run `npm install` in it —
   that is where the Claude SDK override applies, and the same path serves
   « Update » when the range has been raised. A binary (Mistral Vibe): we
   read the ACP registry entry (github.com/agentclientprotocol/registry) to
   get the latest version, take this machine's archive, download and
   extract it. If the registry does not answer, a known version is the
   fallback.
--------------------------------------------------------------------------- */

const REGISTRY = "https://raw.githubusercontent.com/agentclientprotocol/registry/main";

/** The registry's platform key for this machine. */
export function platformKey(): string {
  const os_ = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  return `${os_}-${arch}`;
}

async function archiveUrl(agent: AcpAgentId): Promise<string> {
  const src = AGENT_SOURCES[agent];
  if (src.kind !== "download") throw new Error(`${acpAgentInfo(agent).label} is not a downloadable agent.`);
  const key = platformKey();
  try {
    const res = await fetch(`${REGISTRY}/${src.registryId}/agent.json`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const json = (await res.json()) as { distribution?: { binary?: Record<string, { archive?: string }> } };
      const url = json.distribution?.binary?.[key]?.archive;
      if (url) return url;
    }
  } catch {
    /* registry unreachable: fallback */
  }
  const fallback = src.fallback[key];
  if (!fallback) throw new Error(`${acpAgentInfo(agent).label} is not distributed for ${key}.`);
  return fallback;
}

const installing = new Map<AcpAgentId, Promise<void>>();
const failures = new Map<AcpAgentId, string>();

export const isInstalling = (agent: AcpAgentId) => installing.has(agent);
export const installFailure = (agent: AcpAgentId) => failures.get(agent) ?? null;

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

async function installNpm(agent: AcpAgentId, src: NpmSource): Promise<void> {
  const dir = agentDir(agent);
  await fs.mkdir(dir, { recursive: true });
  /* An interrupted installation starts over: a half-extracted package has
     no package.json, npm picks it up again, but a truncated binary that
     has one would stay. */
  if (brokenInstall(agent)) await fs.rm(path.join(dir, "node_modules"), { recursive: true, force: true });
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(installPackageJson(src), null, 2) + "\n");
  const npm = npmCli();
  const r = await runCommand(npm.command, [...npm.args, "install", "--no-audit", "--no-fund", "--package-lock=true", "--loglevel=error"], 15 * 60_000, { cwd: dir, shell: npm.shell });
  /* `npm.command === "npm"` is `npmCli`'s last resort: it located no
     `npm-cli.js`, so a failure here may simply be npm missing. We cannot
     read that off the output — under `shell` it is `cmd.exe` that answers,
     in the machine's own language — so we go by how npm was resolved. */
  if (r.code !== 0) {
    const detail = r.out.trim().slice(-300);
    const hint = npm.command === "npm" ? " — npm may not be installed, or not on this app's PATH; installing Node.js from nodejs.org includes it." : "";
    throw new Error(`npm install failed: ${detail}${hint}`);
  }
  const broken = brokenInstall(agent);
  if (broken) throw new Error(broken);
}

async function installDownload(agent: AcpAgentId): Promise<void> {
  const url = await archiveUrl(agent);
  const dir = agentDir(agent);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bytnode-acp-"));
  const archive = path.join(tmp, url.endsWith(".tar.gz") ? "agent.tar.gz" : "agent.zip");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Download refused (${res.status}).`);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(archive));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await extract(archive, dir);
    if (process.platform !== "win32") {
      for (const f of await fs.readdir(dir)) await fs.chmod(path.join(dir, f), 0o755).catch(() => {});
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function extract(archive: string, dir: string) {
  let r: { code: number | null; out: string };
  if (archive.endsWith(".tar.gz")) r = await runCommand("tar", ["-xzf", archive, "-C", dir], 5 * 60_000);
  else if (process.platform === "win32") {
    r = await runCommand("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}'`], 5 * 60_000);
  } else r = await runCommand("unzip", ["-o", "-q", archive, "-d", dir], 5 * 60_000);
  if (r.code !== 0) throw new Error(`Could not extract: ${r.out.trim().slice(-300)}`);
}

export async function uninstallAgent(agent: AcpAgentId): Promise<void> {
  await fs.rm(agentDir(agent), { recursive: true, force: true });
}
