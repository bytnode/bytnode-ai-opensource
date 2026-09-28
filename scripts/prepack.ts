/* Before `npm publish` / `npm pack`: clean build, cache removed, finance
   MCP server bundled, archive checked. Refuses to publish if a forbidden
   file or a key is in it, or if the bundle is missing.
   `--ignore-scripts` on the inner `npm pack`: otherwise prepack runs again.
   ⚠️ EVERYTHING HERE WRITES TO STDERR: npm runs this script with its own
   stdout, and `npm pack --json` must stay valid JSON (the Next banner and
   our lines used to come before it). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { containing, forbiddenPaths, isTextFile, leakedSecrets, machinePathNeedles, missingPaths } from "../lib/publish/pack-check";
import { SERVER_BUNDLE } from "../lib/mcp/server-launch";

const root = process.cwd();

const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
/* A clean build — but `.next/dev` belongs to the `next dev` that is usually
   running: removing it broke the user's session, and it is kept out of the
   archive by `files` anyway. */
const dotNext = path.join(root, ".next");
for (const e of fs.existsSync(dotNext) ? fs.readdirSync(dotNext) : []) {
  if (e !== "dev") fs.rmSync(path.join(dotNext, e), { recursive: true, force: true });
}
const build = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: ["ignore", 2, 2] });
if (build.status !== 0) {
  console.error(`prepack: next build failed (${build.status}).`);
  process.exit(1);
}
fs.rmSync(path.join(root, ".next", "cache"), { recursive: true, force: true });

/* ⚠️ EXTERNAL PACKAGES ARE LINKED THROUGH A HASHED ALIAS. Turbopack compiles
   `require("fast-glob")` (serverExternalPackages) into
   `require("fast-glob-461a4a069d284914")`, and resolves that alias through a
   symlink `.next/node_modules/fast-glob-461a…` → the ABSOLUTE node_modules
   of the build machine. npm ships neither symlinks nor node_modules: on the
   user's machine, "Cannot find module 'fast-glob-461a…'". We put the real
   name back in the chunks — Node resolves it from the user's node_modules,
   where the package is a dependency — and remove the links. */
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
  console.error(`prepack: ${aliases.length} external aliases restored to their real names in ${rewritten} files (${aliases.map(([, r]) => r).join(", ")}).`);
  return rewritten;
}
unaliasExternals();

/* ⚠️ THE FINANCE MCP SERVER, BUNDLED. Subscription agents launch
   `lib/mcp/finance-server.ts`; from an installed package tsx cannot run it
   (it ignores the tsconfig `paths` under node_modules: "Cannot find module
   '@/lib/tools/registry'"), and every agent lost its BytNode-AI tools,
   silently. One ESM file: the `@/` aliases resolved now, every package
   left external (Node finds them in the user's node_modules), a `require`
   for the CommonJS ones. `lib/mcp/server-launch.ts` launches it.
   esbuild comes with tsx, a dependency. */
function bundleFinanceServer(): void {
  const req = createRequire(path.join(root, "package.json"));
  const esbuild = req(req.resolve("esbuild", { paths: [path.dirname(req.resolve("tsx/package.json"))] })) as typeof import("esbuild");
  const outfile = path.join(root, SERVER_BUNDLE);
  const t0 = Date.now();
  esbuild.buildSync({
    entryPoints: [path.join(root, "lib", "mcp", "finance-server.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    tsconfig: path.join(root, "tsconfig.json"),
    outfile,
    logLevel: "warning",
    /* No absolute path of this machine in the output (checked below). */
    absWorkingDir: root,
    banner: { js: "import { createRequire as __bytnodeRequire } from 'node:module'; const require = __bytnodeRequire(import.meta.url);" },
  });
  console.error(`prepack: finance MCP server bundled into ${SERVER_BUNDLE} in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}
bundleFinanceServer();

/* `required-server-files.json` carries the ABSOLUTE path of the project
   (`appDir`): the user name and the directory tree of the build machine.
   `next start` does not read this file (it serves hosting providers, in
   standalone mode); we blank the path, and the check below refuses the
   archive if it reappears or if another file mentions it. */
const rootJson = JSON.stringify(root).slice(1, -1);
for (const name of ["required-server-files.json", "required-server-files.js"]) {
  const f = path.join(root, ".next", name);
  if (fs.existsSync(f)) fs.writeFileSync(f, fs.readFileSync(f, "utf8").split(rootJson).join("").split(root).join(""));
}

const npm = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (npm.status !== 0) {
  console.error("prepack: npm pack --dry-run failed.\n" + npm.stderr);
  process.exit(1);
}
const [pack] = JSON.parse(npm.stdout) as { files: { path: string; size: number }[]; size: number; unpackedSize: number }[];
const paths = pack.files.map((f) => f.path);

const bad = forbiddenPaths(paths);
const missing = missingPaths(paths);
const texts = paths.filter(isTextFile).map((p) => ({ path: p, text: fs.readFileSync(path.join(root, p), "utf8") }));
const leaks = leakedSecrets(texts);
const machine = containing(texts, machinePathNeedles(root));
if (bad.length || missing.length || leaks.length || machine.length) {
  console.error("prepack: PUBLISH REFUSED.");
  for (const p of bad) console.error(`  forbidden file: ${p}`);
  for (const p of missing) console.error(`  missing file: ${p}`);
  for (const p of leaks) console.error(`  key detected in: ${p}`);
  for (const p of machine) console.error(`  this machine's path in: ${p}`);
  process.exit(1);
}
console.error(`prepack: ${paths.length} files, ${(pack.size / 1e6).toFixed(1)} MB compressed, ${(pack.unpackedSize / 1e6).toFixed(1)} MB unpacked — archive clean.`);
