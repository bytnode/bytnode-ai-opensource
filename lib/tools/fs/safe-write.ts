import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renameRetry } from "@/lib/plugins/core/store";

/* ---------------------------------------------------------------------------
   Writing a file the agent edits, without losing a write.

   ⚠️ TWO EDITS OF ONE FILE AT ONCE LOST EACH OTHER. Workflow sub-agents run
   three at a time in the same workspace, and a model can issue parallel
   calls: each Edit read the whole file, replaced its excerpt and wrote the
   whole file back — ten edits reported success, three survived. And
   `writeFile` truncates before it writes: a reader in between saw half a
   file. So:
   - `serialized(file, fn)`: the calls on ONE file run one after the other
     in this process (the Next server, where the file tools run);
   - `writeFileAtomic`: a temporary file next to the target, renamed over
     it — a reader sees the old file or the new one, never half of one.
--------------------------------------------------------------------------- */

const queues = new Map<string, Promise<void>>();

/* Windows and macOS disks ignore letter case: one file, one queue. */
const keyOf = (file: string) => {
  const abs = path.resolve(file);
  return process.platform === "win32" || process.platform === "darwin" ? abs.toLowerCase() : abs;
};

/** Runs `fn` once every earlier call on the same file has finished. */
export function serialized<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const key = keyOf(file);
  const before = queues.get(key) ?? Promise.resolve();
  const result = before.then(fn);
  const done = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, done);
  void done.then(() => {
    if (queues.get(key) === done) queues.delete(key);
  });
  return result;
}

const BUSY = ["EPERM", "EACCES", "EBUSY"];

/** Replaces the file's content in one step. A symbolic link is followed
    (its target is rewritten, the link stays a link); the file's mode is
    kept on macOS / Linux (an executable script stays executable). */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  const real = await fs.realpath(target).catch(() => target);
  const dir = path.dirname(real);
  await fs.mkdir(dir, { recursive: true });
  const before = await fs.stat(real).catch(() => null);
  const tmp = path.join(dir, `.${path.basename(real)}.${randomUUID().slice(0, 8)}.tmp`);
  await fs.writeFile(tmp, data);
  try {
    if (before && process.platform !== "win32") await fs.chmod(tmp, before.mode & 0o7777);
    await renameRetry(tmp, real);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    /* A program that holds the file open without sharing its deletion (a
       spreadsheet showing the CSV) refuses the rename on Windows but may
       still accept a write: the old way, in place, rather than nothing. */
    if (BUSY.includes((e as NodeJS.ErrnoException).code ?? "")) {
      await fs.writeFile(real, data);
      return;
    }
    throw e;
  }
}
