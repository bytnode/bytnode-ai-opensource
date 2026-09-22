/* The package as a user receives it: `npm pack`, install the .tgz in a
   temporary folder, `bytnode-ai --no-open`, then the three checks that
   matter — the page answers, the tools and professions load from the
   package, the data folder is the one from BYTNODE_AI_HOME. No key, no
   agent: zero tokens. `npm run smoke:pack`. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const shell = process.platform === "win32";
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", shell });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: exit code ${r.status}`);
  return r.stdout.trim();
};

const tgz = path.join(root, sh("npm", ["pack", "--json"], root).match(/"filename":\s*"([^"]+)"/)[1]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bytnode-ai-smoke-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home);
try {
  sh("npm", ["init", "-y"], tmp);
  sh("npm", ["install", "--no-audit", "--no-fund", tgz], tmp);
  const bin = path.join(tmp, "node_modules", "bytnode-ai", "bin", "bytnode-ai.mjs");
  const port = 3790 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, [bin, "--port", String(port), "--no-open"], { stdio: "inherit", env: { ...process.env, BYTNODE_AI_HOME: home } });
  try {
    /* The server binds 127.0.0.1 only (bin/bytnode-ai.mjs): probe that
       address, not `localhost`, which Windows resolves to ::1 first. */
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90_000;
    let ok = false;
    while (!ok && Date.now() < deadline) {
      try {
        ok = (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ok) throw new Error("the page is not answering");
    const tools = await fetch(`${url}/api/tools?profession=standard&agentId=smoke`);
    if (!tools.ok) throw new Error(`/api/tools: ${tools.status}`);
    const body = await tools.json();
    const names = (body.tools ?? []).map((t) => t.function?.name);
    if (!names.includes("Skill") || !names.includes("Read")) throw new Error(`/api/tools does not list the tools: ${names.join(", ")}`);
    const expected = path.join(home, "workspaces", "smoke");
    if (path.resolve(body.workspace) !== expected || !fs.existsSync(expected)) throw new Error(`unexpected workspace: ${body.workspace}`);
    console.log(`smoke: OK (${path.basename(tgz)}, port ${port}, ${names.length} tools, data in ${home})`);
  } finally {
    child.kill();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
}
