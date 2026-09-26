import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { dataDir } from "@/lib/server/data-dir";
import { appendJsonl, pluginsDir, readJson, readJsonl, writeJsonAtomic } from "../core/store";
import { isUserPluginId, readUserManifest, type UserManifest } from "./manifest";
import type { Grant, Permissions } from "./permissions";

/* ---------------------------------------------------------------------------
   The plugins written by agents, on disk: `~/.bytnode-ai/user-plugins/<id>/`.

     draft/      what the agent writes and rewrites (PluginWrite): plugin.json,
                 server.js, tests.js, view/…  — the ONLY place an agent writes
     active/     the copy that runs: made at activation, never edited
     grant.json  what the user granted (permissions, accounts, the digest
                 of the files that run) — written by the user's approval only
     request.json  an activation waiting for the user
     meta.json   who made it, when; who changed it last
     log.jsonl   what went wrong (setup, a call, the page), bounded

   The plugin's DATA is elsewhere, like every plugin's: `plugins/<id>/`.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

export const userPluginsDir = (): string => path.join(dataDir(), "user-plugins");
const dirOf = (id: string) => {
  if (!isUserPluginId(id)) throw new Error(`Invalid plugin id: ${id}.`);
  return path.join(userPluginsDir(), id);
};

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_VIEW_FILES = 20;
const MAX_LOG = 200;

/** May the agent write this file? A flat, known layout only. */
export function allowedFile(name: string): boolean {
  return name === "plugin.json" || name === "server.js" || name === "tests.js" || /^view\/[a-z0-9][a-z0-9-]{0,40}\.(html|css|js)$/.test(name);
}

export type Which = "draft" | "active";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of ["plugin.json", "server.js", "tests.js"]) if (fs.existsSync(path.join(dir, name))) out.push(name);
  const view = path.join(dir, "view");
  if (fs.existsSync(view)) for (const f of (await fsp.readdir(view)).sort()) if (allowedFile(`view/${f}`)) out.push(`view/${f}`);
  return out;
}

/** The files of a version, by name → text. */
export async function readFiles(id: string, which: Which): Promise<Record<string, string>> {
  const dir = path.join(dirOf(id), which);
  const out: Record<string, string> = {};
  for (const name of await walk(dir)) out[name] = await fsp.readFile(path.join(dir, name), "utf8");
  return out;
}

/** One fingerprint for a set of files: what the user reviewed is what runs. */
export function digestOf(files: Record<string, string>): string {
  const h = createHash("sha256");
  for (const name of Object.keys(files).sort()) h.update(`${name}\0${files[name]}\0`);
  return h.digest("hex").slice(0, 32);
}

export type Meta = { createdBy: string; createdAt: string; updatedBy: string; updatedAt: string };

export const readMeta = (id: string) => readJson<Meta | null>(path.join(dirOf(id), "meta.json"), null);
export const readGrant = (id: string) => readJson<Grant | null>(path.join(dirOf(id), "grant.json"), null);

export type ActivationRequest = {
  digest: string;
  permissions: Permissions;
  agentId: string;
  at: string;
  /** What the check saw it register, for the review screen. */
  tools: Array<{ name: string; readOnly: boolean }>;
};
export const readRequest = (id: string) => readJson<ActivationRequest | null>(path.join(dirOf(id), "request.json"), null);
export const writeRequest = (id: string, r: ActivationRequest) => writeJsonAtomic(path.join(dirOf(id), "request.json"), r);
export const clearRequest = (id: string) => fsp.rm(path.join(dirOf(id), "request.json"), { force: true });

/** Writes one draft file; `null` deletes it. Checks the layout and sizes. */
export async function writeDraftFile(id: string, name: string, content: string | null, agentId: string): Promise<void> {
  if (!allowedFile(name)) throw new Error(`Not a plugin file: ${name}. Allowed: plugin.json, server.js, tests.js, view/<name>.html|css|js.`);
  const dir = path.join(dirOf(id), "draft");
  const file = path.join(dir, name);
  if (content === null) {
    await fsp.rm(file, { force: true });
  } else {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`${name} is too large (${Math.round(bytes / 1024)} kB, ${MAX_FILE_BYTES / 1024} kB at most).`);
    const current = await readFiles(id, "draft").catch(() => ({}) as Record<string, string>);
    const total = Object.entries(current).reduce((n, [k, v]) => n + (k === name ? 0 : Buffer.byteLength(v, "utf8")), bytes);
    if (total > MAX_TOTAL_BYTES) throw new Error(`The plugin would weigh ${Math.round(total / 1024)} kB: ${MAX_TOTAL_BYTES / 1024} kB at most.`);
    if (name.startsWith("view/") && !(name in current) && Object.keys(current).filter((k) => k.startsWith("view/")).length >= MAX_VIEW_FILES) throw new Error(`${MAX_VIEW_FILES} view files at most.`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    await fsp.writeFile(tmp, content);
    await fsp.rename(tmp, file);
  }
  const now = new Date().toISOString();
  const meta = await readMeta(id);
  await writeJsonAtomic(path.join(dirOf(id), "meta.json"), { createdBy: meta?.createdBy ?? agentId, createdAt: meta?.createdAt ?? now, updatedBy: agentId, updatedAt: now } satisfies Meta);
}

/** The draft becomes what runs, under this grant. The files are copied as
    they were reviewed: `digest` must still be the draft's. */
export async function activate(id: string, grant: Grant): Promise<void> {
  const files = await readFiles(id, "draft");
  if (digestOf(files) !== grant.digest) throw new Error("The plugin changed since it was reviewed: ask the agent to activate it again.");
  const root = dirOf(id);
  const staging = path.join(root, `active.${randomUUID().slice(0, 8)}.tmp`);
  for (const [name, text] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(staging, name)), { recursive: true });
    await fsp.writeFile(path.join(staging, name), text);
  }
  await fsp.rm(path.join(root, "active"), { recursive: true, force: true });
  await fsp.rename(staging, path.join(root, "active"));
  await writeJsonAtomic(path.join(root, "grant.json"), grant);
  await clearRequest(id);
}

/** Stops it for good: what ran and what was granted go; the draft stays. */
export async function revoke(id: string): Promise<void> {
  const root = dirOf(id);
  await fsp.rm(path.join(root, "grant.json"), { force: true });
  await fsp.rm(path.join(root, "active"), { recursive: true, force: true });
  await clearRequest(id);
}

/** Deletes the plugin, and its data if asked. */
export async function removeUserPlugin(id: string, withData: boolean): Promise<void> {
  await fsp.rm(dirOf(id), { recursive: true, force: true });
  if (withData) await fsp.rm(path.join(pluginsDir(), id), { recursive: true, force: true });
}

export type LogEntry = { at: string; level: "info" | "warn" | "error"; source: "setup" | "call" | "job" | "view" | "check" | "log"; message: string };

export async function appendLog(id: string, entry: Omit<LogEntry, "at">): Promise<void> {
  await appendJsonl(path.join(dirOf(id), "log.jsonl"), { at: new Date().toISOString(), ...entry, message: entry.message.slice(0, 1000) }, MAX_LOG);
}

export const readLog = async (id: string, last = 30): Promise<LogEntry[]> => (await readJsonl<LogEntry>(path.join(dirOf(id), "log.jsonl"))).slice(-last);

export const userPluginIds = async (): Promise<string[]> => {
  const dir = userPluginsDir();
  if (!fs.existsSync(dir)) return [];
  return (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && isUserPluginId(e.name)).map((e) => e.name).sort();
};

/** A version's manifest, read and checked. */
export async function manifestOf(id: string, files: Record<string, string>): Promise<{ ok: true; value: UserManifest } | { ok: false; errors: string[] }> {
  if (!files["plugin.json"]) return { ok: false, errors: ["plugin.json is missing."] };
  let raw: unknown;
  try {
    raw = JSON.parse(files["plugin.json"]);
  } catch (e) {
    return { ok: false, errors: [`plugin.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  return readUserManifest(id, raw);
}

/** What runs: the plugins with a grant whose active files are exactly the
    ones reviewed. A mismatch is reported, not run. */
export type ActivePlugin = { id: string; manifest: UserManifest; grant: Grant; files: Record<string, string> };

export async function activePlugins(): Promise<{ plugins: ActivePlugin[]; problems: Array<{ id: string; message: string }> }> {
  const plugins: ActivePlugin[] = [];
  const problems: Array<{ id: string; message: string }> = [];
  for (const id of await userPluginIds()) {
    try {
      const grant = await readGrant(id);
      if (!grant) continue;
      const files = await readFiles(id, "active");
      if (digestOf(files) !== grant.digest) {
        problems.push({ id, message: "Its files are not the ones you approved: it does not run. Ask the agent to activate it again." });
        continue;
      }
      const m = await manifestOf(id, files);
      if (!m.ok) {
        problems.push({ id, message: m.errors.join(" ") });
        continue;
      }
      plugins.push({ id, manifest: m.value, grant, files });
    } catch (e) {
      problems.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { plugins, problems };
}

/** Changes when what runs changes (an activation, a revocation, a
    removal): the host reloads, a subscription session restarts its MCP
    server. Synchronous and cheap: a few `stat`s. */
export function userPluginsVersion(): string {
  const dir = userPluginsDir();
  if (!fs.existsSync(dir)) return "0";
  const parts: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || !isUserPluginId(e.name)) continue;
    const grant = path.join(dir, e.name, "grant.json");
    parts.push(`${e.name}:${fs.existsSync(grant) ? Math.floor(fs.statSync(grant).mtimeMs) : 0}`);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
