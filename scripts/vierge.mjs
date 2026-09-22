/* `npm run vierge`: the system as on the very first launch.

   Three things hold state, all neutralised without erasing anything:
   - the data folder (~/.bytnode-ai: installed agents, workspaces) → a fresh
     folder in the temp directory, removed on exit;
   - the agents found on the PATH (gemini, copilot, grok) →
     BYTNODE_AI_IGNORE_PATH, all six show "Install";
   - the browser's localStorage (keys, settings, conversations), bound to
     the origin and therefore to the port → a random port between 3800 and
     3899.
   Port 3777 and ~/.bytnode-ai are left untouched. Options: --no-build
   (keep the current build), --no-open. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));

if (!args.has("--no-build")) {
  console.log("vierge: next build (about 1 min; --no-build to keep the current build)…");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const build = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bytnode-ai-vierge-"));
const port = await freePort();
console.log(`vierge: data in ${home} (removed on exit), port ${port}, no agent recognised on the PATH.`);

const child = spawn(process.execPath, [path.join(root, "bin", "bytnode-ai.mjs"), "--port", String(port), ...(args.has("--no-open") ? ["--no-open"] : [])], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, BYTNODE_AI_HOME: home, BYTNODE_AI_IGNORE_PATH: "1" },
});
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill("SIGTERM"));
child.on("exit", (code) => {
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.error(`vierge: temporary folder not removed: ${home}`);
  }
  process.exit(code ?? 0);
});

async function freePort() {
  for (let i = 0; i < 20; i++) {
    const p = 3800 + Math.floor(Math.random() * 100);
    if (await free(p)) return p;
  }
  throw new Error("vierge: no free port between 3800 and 3899.");
}

function free(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
