/* Avant `npm publish` / `npm pack` : build propre, cache retire, archive
   controlee. Refuse de publier si un fichier interdit ou une cle y figure.
   `--ignore-scripts` sur le `npm pack` interne : sinon prepack se relance. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { forbiddenPaths, isTextFile, leakedSecrets } from "../lib/publish/pack-check";

const root = process.cwd();

const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });
const build = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) {
  console.error(`prepack : next build a échoué (${build.status}).`);
  process.exit(1);
}
fs.rmSync(path.join(root, ".next", "cache"), { recursive: true, force: true });

const npm = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (npm.status !== 0) {
  console.error("prepack : npm pack --dry-run a échoué.\n" + npm.stderr);
  process.exit(1);
}
const [pack] = JSON.parse(npm.stdout) as { files: { path: string; size: number }[]; size: number; unpackedSize: number }[];
const paths = pack.files.map((f) => f.path);

const bad = forbiddenPaths(paths);
const leaks = leakedSecrets(paths.filter(isTextFile).map((p) => ({ path: p, text: fs.readFileSync(path.join(root, p), "utf8") })));
if (bad.length || leaks.length) {
  console.error("prepack : PUBLICATION REFUSÉE.");
  for (const p of bad) console.error(`  fichier interdit : ${p}`);
  for (const p of leaks) console.error(`  clé détectée dans : ${p}`);
  process.exit(1);
}
console.log(`prepack : ${paths.length} fichiers, ${(pack.size / 1e6).toFixed(1)} Mo compressés, ${(pack.unpackedSize / 1e6).toFixed(1)} Mo décompressés — archive propre.`);
