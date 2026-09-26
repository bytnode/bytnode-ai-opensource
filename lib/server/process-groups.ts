import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/* ---------------------------------------------------------------------------
   Stopping a process AND what it launched, on every system.

   Windows: `taskkill /t` walks the tree. macOS / Linux have no tree to walk:
   the child is started in a process group of its own (`detached: true`,
   see `groupSpawnOptions`) and the whole group is signalled — a python
   script under bash, an agent's MCP server under the agent.

   ⚠️ A GROUP OF ITS OWN LEAVES THE TERMINAL'S: Ctrl+C on `bytnode-ai` no
   longer reaches it. So every group still alive is killed when this
   server exits (Next turns SIGINT / SIGTERM into `process.exit`).
--------------------------------------------------------------------------- */

const posix = process.platform !== "win32";
const live = new Set<number>();
let hooked = false;

/** The spawn options that give the child a group of its own (POSIX only). */
export const groupSpawnOptions = () => ({ detached: posix });

/** Remembers the child's group until it exits. */
export function trackGroup(child: ChildProcess): void {
  if (!posix || !child.pid) return;
  const pid = child.pid;
  live.add(pid);
  child.once("exit", () => live.delete(pid));
  if (!hooked) {
    hooked = true;
    process.once("exit", () => {
      for (const p of live) signalGroup(p, "SIGKILL");
    });
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Stops the child and everything it launched. `sync`: wait for taskkill
    (Windows), for a caller that is about to leave. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL", sync = false): void {
  if (!child.pid) return;
  if (posix) {
    if (!signalGroup(child.pid, signal) && child.exitCode === null) child.kill(signal);
    return;
  }
  if (child.exitCode !== null) return;
  const args = ["/pid", String(child.pid), "/t", "/f"];
  if (sync) {
    const r = spawnSync("taskkill", args, { windowsHide: true });
    if (r.error) child.kill();
    return;
  }
  const tk = spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
  tk.on("error", () => child.kill());
}
