/* `npm run vierge` : le systeme comme au tout premier lancement.

   Trois choses gardent un etat, toutes neutralisees sans rien effacer :
   - le dossier de donnees (~/.bytnode-ai : agents installes, dossiers de
     travail) → un dossier neuf dans le temporaire, supprime a l'arret ;
   - les agents reconnus sur le PATH (gemini, copilot, grok) →
     BYTNODE_AI_IGNORE_PATH, les six affichent « Installer » ;
   - le localStorage du navigateur (cles, reglages, conversations), lie a
     l'origine donc au port → un port tire au hasard entre 3800 et 3899.
   Le port 3777 et ~/.bytnode-ai ne sont pas touches. Options : --no-build
   (garder le build actuel), --no-open. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));

if (!args.has("--no-build")) {
  console.log("vierge : next build (≈ 1 min ; --no-build pour garder le build actuel)…");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const build = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bytnode-ai-vierge-"));
const port = await freePort();
console.log(`vierge : données dans ${home} (supprimé à l'arrêt), port ${port}, aucun agent reconnu sur le PATH.`);

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
    console.error(`vierge : dossier temporaire non supprimé : ${home}`);
  }
  process.exit(code ?? 0);
});

async function freePort() {
  for (let i = 0; i < 20; i++) {
    const p = 3800 + Math.floor(Math.random() * 100);
    if (await free(p)) return p;
  }
  throw new Error("vierge : aucun port libre entre 3800 et 3899.");
}

function free(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
