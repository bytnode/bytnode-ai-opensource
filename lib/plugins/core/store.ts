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
/** The take-over itself lasts milliseconds: a guard older than this was
    left by a crash. */
const TAKEOVER_STALE_MS = 5_000;

export const pluginsDir = (): string => path.join(dataDir(), "plugins");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Windows refuses a file for a moment when another process holds it (an
    antivirus scanning what was just renamed): worth a few retries. */
const BUSY = ["EPERM", "EACCES", "EBUSY"];
const busy = (e: unknown) => BUSY.includes((e as NodeJS.ErrnoException).code ?? "");

/** The file's text, or `null` if it does not exist. ⚠️ A file that EXISTS
    but cannot be read throws: read as "empty", the next update would
    overwrite the user's data. */
async function readText(file: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (attempt >= 5 || !busy(e)) throw e;
      await sleep(RETRY_MS * (attempt + 1));
    }
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const text = await readText(file);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    /* never written by us: the writes are atomic */
    return fallback;
  }
}

/** Writes through a temporary file renamed over the target. Windows can
    refuse the rename for a moment (an antivirus holding the file): a few
    retries. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, text);
  try {
    await renameRetry(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true, recursive: true });
    throw e;
  }
}

/** `rename`, retried while Windows holds the file or the folder (Defender
    scans a freshly written `.js`). */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      if (attempt >= 5 || !busy(e)) throw e;
      await sleep(RETRY_MS * (attempt + 1));
    }
  }
}

/** Runs `fn` holding the file's lock, across processes. */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  /* Our mark in the lock: released only if it is still ours. */
  const token = randomUUID();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lock, "wx");
      try {
        await handle.writeFile(token);
      } catch (e) {
        await handle.close();
        await fs.rm(lock, { force: true });
        throw e;
      }
      await handle.close();
      break;
    } catch (e) {
      /* Windows answers EPERM, not EEXIST, while the holder's lock is being
         deleted: the lock is taken all the same. */
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" && !busy(e)) throw e;
      if (await takeOverStale(lock)) continue;
      if (Date.now() > deadline) throw new Error(`Busy: ${path.basename(file)} is locked by another process.`);
      await sleep(RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    /* Taken over meanwhile (we held it past `STALE_MS`): not ours to remove. */
    const holder = await fs.readFile(lock, "utf8").catch(() => null);
    if (holder === token) await fs.rm(lock, { force: true });
  }
}

/** Removes a lock left by a dead process — ONE waiter at a time. ⚠️ A bare
    `stat → rm` let a late waiter remove the lock the first one had just
    re-created: two writers inside, an update lost. So the take-over runs
    under a second, short-lived lock, and looks at the lock again once
    inside: a fresh one belongs to a live holder and is left alone. */
async function takeOverStale(lock: string): Promise<boolean> {
  const stat = await fs.stat(lock).catch(() => null);
  if (!stat || Date.now() - stat.mtimeMs <= STALE_MS) return false;
  const guard = `${lock}.takeover`;
  try {
    await (await fs.open(guard, "wx")).close();
  } catch {
    /* Someone else is taking it over; a guard left by a crash goes after a while. */
    const g = await fs.stat(guard).catch(() => null);
    if (g && Date.now() - g.mtimeMs > TAKEOVER_STALE_MS) await fs.rm(guard, { force: true });
    return false;
  }
  try {
    const again = await fs.stat(lock).catch(() => null);
    if (again && Date.now() - again.mtimeMs > STALE_MS) await fs.rm(lock, { force: true });
    return true;
  } finally {
    await fs.rm(guard, { force: true });
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
  const text = await readText(file);
  if (text === null) return [];
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

/** Removes the entries `drop` picks, under the lock (an append waits).
    Returns how many went. */
export async function removeJsonl<T>(file: string, drop: (entry: T) => boolean): Promise<number> {
  return withLock(file, async () => {
    const all = await readJsonl<T>(file);
    const kept = all.filter((e) => !drop(e));
    if (kept.length !== all.length) await writeTextAtomic(file, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
    return all.length - kept.length;
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
  /** Removes the lines `drop` picks; how many went. */
  removeLines<T>(name: string, drop: (entry: T) => boolean): Promise<number>;
  /** Deletes everything the plugin stored. */
  clear(): Promise<void>;
};

const NAME = /^[\w-]+(\.[\w-]+)*$/;
/** Windows' device names: `con.json` or `nul.json` is no file there — the
    write goes nowhere, the rename fails. Refused on every system, so a
    plugin behaves the same everywhere. */
export const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export function pluginStore(id: string, root: string = pluginsDir()): PluginStore {
  const dir = path.join(root, id);
  const file = (name: string) => {
    if (!NAME.test(name) || WINDOWS_RESERVED.test(name)) throw new Error(`Invalid data file name: ${name}`);
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
    removeLines: (name, drop) => removeJsonl(file(name), drop),
    clear: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
