import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { agentDir, runCommand } from "./launch";

/* ---------------------------------------------------------------------------
   Installer un agent distribue en binaire (Mistral Vibe).

   Le registre ACP (github.com/agentclientprotocol/registry) publie pour
   chaque agent une archive par plateforme. On lit l'entree du registre
   (pour avoir la derniere version), on prend l'archive de cette machine,
   on la telecharge et on l'extrait dans `~/.bytnode-ai/agents/<id>/`.
   Si le registre ne repond pas, une version connue sert de secours.
--------------------------------------------------------------------------- */

const REGISTRY = "https://raw.githubusercontent.com/agentclientprotocol/registry/main";

/** L'id de chaque agent dans le registre, et l'archive de secours. */
const SOURCES: Partial<Record<AcpAgentId, { registryId: string; fallback: Partial<Record<string, string>> }>> = {
  mistral: {
    registryId: "mistral-vibe",
    fallback: {
      "windows-x86_64": "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1/vibe-acp-windows-x86_64-2.24.1.zip",
      "darwin-aarch64": "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1/vibe-acp-darwin-aarch64-2.24.1.tar.gz",
      "darwin-x86_64": "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1/vibe-acp-darwin-x86_64-2.24.1.tar.gz",
      "linux-x86_64": "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1/vibe-acp-linux-x86_64-2.24.1.tar.gz",
      "linux-aarch64": "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1/vibe-acp-linux-aarch64-2.24.1.tar.gz",
    },
  },
};

/** La cle de plateforme du registre pour cette machine. */
export function platformKey(): string {
  const os_ = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  return `${os_}-${arch}`;
}

async function archiveUrl(agent: AcpAgentId): Promise<string> {
  const src = SOURCES[agent];
  if (!src) throw new Error(`${acpAgentInfo(agent).label} n'est pas un agent à télécharger.`);
  const key = platformKey();
  try {
    const res = await fetch(`${REGISTRY}/${src.registryId}/agent.json`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const json = (await res.json()) as { distribution?: { binary?: Record<string, { archive?: string }> } };
      const url = json.distribution?.binary?.[key]?.archive;
      if (url) return url;
    }
  } catch {
    /* registre injoignable : secours */
  }
  const fallback = src.fallback[key];
  if (!fallback) throw new Error(`${acpAgentInfo(agent).label} n'est pas distribué pour ${key}.`);
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
  const p = (async () => {
    const url = await archiveUrl(agent);
    const dir = agentDir(agent);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bytnode-acp-"));
    const archive = path.join(tmp, url.endsWith(".tar.gz") ? "agent.tar.gz" : "agent.zip");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`Téléchargement refusé (${res.status}).`);
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
  })();
  installing.set(agent, p);
  p.catch((e) => failures.set(agent, e instanceof Error ? e.message : String(e))).finally(() => installing.delete(agent));
  return p;
}

async function extract(archive: string, dir: string) {
  let r: { code: number | null; out: string };
  if (archive.endsWith(".tar.gz")) r = await runCommand("tar", ["-xzf", archive, "-C", dir], 5 * 60_000);
  else if (process.platform === "win32") {
    r = await runCommand("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}'`], 5 * 60_000);
  } else r = await runCommand("unzip", ["-o", "-q", archive, "-d", dir], 5 * 60_000);
  if (r.code !== 0) throw new Error(`Extraction impossible : ${r.out.trim().slice(-300)}`);
}

export async function uninstallAgent(agent: AcpAgentId): Promise<void> {
  await fs.rm(agentDir(agent), { recursive: true, force: true });
}
