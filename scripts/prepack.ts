/* Avant `npm publish` / `npm pack` : build propre, cache retire, archive
   controlee. Refuse de publier si un fichier interdit ou une cle y figure.
   `--ignore-scripts` sur le `npm pack` interne : sinon prepack se relance. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { containing, forbiddenPaths, isTextFile, leakedSecrets } from "../lib/publish/pack-check";

const root = process.cwd();

const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });
const build = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) {
  console.error(`prepack : next build a échoué (${build.status}).`);
  process.exit(1);
}
fs.rmSync(path.join(root, ".next", "cache"), { recursive: true, force: true });

/* ⚠️ LES PAQUETS EXTERNES SONT LIES PAR UN ALIAS HACHE. Turbopack compile
   `require("fast-glob")` (serverExternalPackages) en
   `require("fast-glob-461a4a069d284914")`, et resout cet alias par un lien
   symbolique `.next/node_modules/fast-glob-461a…` → le node_modules ABSOLU
   de la machine de build. npm ne livre ni liens ni node_modules : chez
   l'utilisateur, « Cannot find module 'fast-glob-461a…' ». On remet le vrai
   nom dans les chunks — Node le resout depuis le node_modules de
   l'utilisateur, ou le paquet est une dependance — et on retire les liens. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
function unaliasExternals(): number {
  const links = path.join(root, ".next", "node_modules");
  if (!fs.existsSync(links)) return 0;
  const aliases: [string, string][] = [];
  const visit = (dir: string, scope: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith("@")) visit(path.join(dir, e.name), `${e.name}/`);
      else {
        const m = e.name.match(/^(.+)-[0-9a-f]{16}$/);
        if (m) aliases.push([scope + e.name, scope + m[1]]);
      }
    }
  };
  visit(links, "");
  let rewritten = 0;
  for (const f of walk(path.join(root, ".next", "server")).filter((f) => /\.(js|json)$/.test(f))) {
    let s = fs.readFileSync(f, "utf8");
    const before = s;
    for (const [alias, real] of aliases) s = s.split(alias).join(real);
    if (s !== before) {
      fs.writeFileSync(f, s);
      rewritten++;
    }
  }
  fs.rmSync(links, { recursive: true, force: true });
  console.log(`prepack : ${aliases.length} alias externes remis en clair dans ${rewritten} fichiers (${aliases.map(([, r]) => r).join(", ")}).`);
  return rewritten;
}
unaliasExternals();

/* `required-server-files.json` porte le chemin ABSOLU du projet (`appDir`) :
   le nom d'utilisateur et l'arborescence de la machine de build. `next
   start` ne lit pas ce fichier (il sert aux hebergeurs, en mode standalone) ;
   on efface le chemin, et le controle plus bas refuse l'archive s'il
   reapparait ou si un autre fichier le cite. */
const rootJson = JSON.stringify(root).slice(1, -1);
for (const name of ["required-server-files.json", "required-server-files.js"]) {
  const f = path.join(root, ".next", name);
  if (fs.existsSync(f)) fs.writeFileSync(f, fs.readFileSync(f, "utf8").split(rootJson).join("").split(root).join(""));
}

const npm = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (npm.status !== 0) {
  console.error("prepack : npm pack --dry-run a échoué.\n" + npm.stderr);
  process.exit(1);
}
const [pack] = JSON.parse(npm.stdout) as { files: { path: string; size: number }[]; size: number; unpackedSize: number }[];
const paths = pack.files.map((f) => f.path);

const bad = forbiddenPaths(paths);
const texts = paths.filter(isTextFile).map((p) => ({ path: p, text: fs.readFileSync(path.join(root, p), "utf8") }));
const leaks = leakedSecrets(texts);
const machine = containing(texts, [root, rootJson]);
if (bad.length || leaks.length || machine.length) {
  console.error("prepack : PUBLICATION REFUSÉE.");
  for (const p of bad) console.error(`  fichier interdit : ${p}`);
  for (const p of leaks) console.error(`  clé détectée dans : ${p}`);
  for (const p of machine) console.error(`  chemin de cette machine dans : ${p}`);
  process.exit(1);
}
console.log(`prepack : ${paths.length} fichiers, ${(pack.size / 1e6).toFixed(1)} Mo compressés, ${(pack.unpackedSize / 1e6).toFixed(1)} Mo décompressés — archive propre.`);
