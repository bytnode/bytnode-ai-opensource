/* Le paquet, tel qu'un utilisateur le recoit : `npm pack`, installation du
   .tgz dans un dossier temporaire, `bytnode-ai --no-open`, puis les trois
   verifications qui comptent — la page repond, les outils et professions
   se chargent depuis le paquet, le dossier des donnees est celui de
   BYTNODE_AI_HOME. Sans cle ni agent : zero jeton. `npm run smoke:pack`. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const shell = process.platform === "win32";
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", shell });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} : code ${r.status}`);
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
    const url = `http://localhost:${port}`;
    const deadline = Date.now() + 90_000;
    let ok = false;
    while (!ok && Date.now() < deadline) {
      try {
        ok = (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ok) throw new Error("la page ne répond pas");
    const tools = await fetch(`${url}/api/tools?profession=standard&agentId=smoke`);
    if (!tools.ok) throw new Error(`/api/tools : ${tools.status}`);
    const body = await tools.json();
    const names = (body.tools ?? []).map((t) => t.function?.name);
    if (!names.includes("Skill") || !names.includes("Read")) throw new Error(`/api/tools ne liste pas les outils : ${names.join(", ")}`);
    const expected = path.join(home, "workspaces", "smoke");
    if (path.resolve(body.workspace) !== expected || !fs.existsSync(expected)) throw new Error(`dossier de travail inattendu : ${body.workspace}`);
    console.log(`smoke : OK (${path.basename(tgz)}, port ${port}, ${names.length} outils, données dans ${home})`);
  } finally {
    child.kill();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
}
