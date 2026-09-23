import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "@/lib/server/data-dir";

/* ---------------------------------------------------------------------------
   Where plugins keep their data: `~/.bytnode-ai/plugins/<id>/`, in JSON or
   JSONL files the user owns and can read.

   ⚠️ TWO PROCESSES WRITE HERE. The Next server (background jobs, the
   views) and the MCP server of each subscription session (the same tools,
   in another process). So every read-modify-write takes a LOCK file next
   to the data, and every write goes through a temporary file renamed over
   the old one: a crash never leaves half a file, and two writers never
   lose each other's update. A lock older than `STALE_MS` belongs to a dead
   process and is taken over.

   Keys and secrets never come here.
--------------------------------------------------------------------------- */

const LOCK_WAIT_MS = 10_000;
const STALE_MS = 30_000;
const RETRY_MS = 25;

export const pluginsDir = (): string => path.join(dataDir(), "plugins");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Writes through a temporary file renamed over the target. Windows can
    refuse the rename for a moment (an antivirus holding the file): a few
    retries. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
      await sleep(RETRY_MS * (attempt + 1));
    }
  }
}

/** Runs `fn` holding the file's lock, across processes. */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lock, "wx");
      await handle.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > STALE_MS) {
        await fs.rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Busy: ${path.basename(file)} is locked by another process.`);
      await sleep(RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { force: true });
  }
}

/** Read, change, write — under the lock. Returns what was written. */
export async function updateJson<T>(file: string, fallback: T, change: (current: T) => T | Promise<T>): Promise<T> {
  return withLock(file, async () => {
    const next = await change(await readJson(file, fallback));
    await writeJsonAtomic(file, next);
    return next;
  });
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* a line cut by a crash: skipped */
    }
  }
  return out;
}

/** Appends one entry; beyond `max` entries, the oldest are dropped. */
export async function appendJsonl(file: string, entry: unknown, max?: number): Promise<void> {
  await withLock(file, async () => {
    const line = `${JSON.stringify(entry)}\n`;
    if (max === undefined) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, line);
      return;
    }
    const all = await readJsonl<unknown>(file);
    all.push(entry);
    const kept = all.slice(-max);
    await writeTextAtomic(file, kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
  });
}

/** A plugin's own corner of the data folder. File names are plain names:
    no path, no climbing out. */
export type PluginStore = {
  readonly dir: string;
  file(name: string): string;
  read<T>(name: string, fallback: T): Promise<T>;
  write(name: string, value: unknown): Promise<void>;
  update<T>(name: string, fallback: T, change: (current: T) => T | Promise<T>): Promise<T>;
  append(name: string, entry: unknown, max?: number): Promise<void>;
  lines<T>(name: string): Promise<T[]>;
  /** Deletes everything the plugin stored. */
  clear(): Promise<void>;
};

const NAME = /^[\w-]+(\.[\w-]+)*$/;

export function pluginStore(id: string, root: string = pluginsDir()): PluginStore {
  const dir = path.join(root, id);
  const file = (name: string) => {
    if (!NAME.test(name)) throw new Error(`Invalid data file name: ${name}`);
    return path.join(dir, name);
  };
  return {
    dir,
    file,
    read: (name, fallback) => readJson(file(name), fallback),
    write: (name, value) => withLock(file(name), () => writeJsonAtomic(file(name), value)),
    update: (name, fallback, change) => updateJson(file(name), fallback, change),
    append: (name, entry, max) => appendJsonl(file(name), entry, max),
    lines: (name) => readJsonl(file(name)),
    clear: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
