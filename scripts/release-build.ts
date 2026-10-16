/* The release build of the npm package (`prepack.ts`): a clean `next
   build`, the external packages' aliases restored, the finance MCP server
   bundled, this machine's path blanked.
   ⚠️ EVERYTHING HERE WRITES TO STDERR (see prepack.ts: `npm pack --json`). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { SERVER_BUNDLE } from "../lib/mcp/server-launch";

const say = (tag: string, line: string) => console.error(`${tag}: ${line}`);

/** A clean build — but `.next/dev` belongs to the `next dev` that is
    usually running: removing it broke the user's session, and it is kept
    out of the archive anyway. */
export function cleanBuild(root: string, tag: string): void {
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const dotNext = path.join(root, ".next");
  for (const e of fs.existsSync(dotNext) ? fs.readdirSync(dotNext) : []) {
    if (e !== "dev") fs.rmSync(path.join(dotNext, e), { recursive: true, force: true });
  }
  const build = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: ["ignore", 2, 2] });
  if (build.status !== 0) {
    say(tag, `next build failed (${build.status}).`);
    process.exit(1);
  }
  fs.rmSync(path.join(root, ".next", "cache"), { recursive: true, force: true });
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** ⚠️ EXTERNAL PACKAGES ARE LINKED THROUGH A HASHED ALIAS. Turbopack compiles
    `require("fast-glob")` (serverExternalPackages) into
    `require("fast-glob-461a4a069d284914")`, and resolves that alias through a
    symlink `.next/node_modules/fast-glob-461a…` → the ABSOLUTE node_modules
    of the build machine. Neither npm nor an installer carries that link: on
    the user's machine, "Cannot find module 'fast-glob-461a…'". We put the
    real name back in the chunks — Node resolves it from the node_modules
    shipped beside, where the package is a dependency — and remove the links. */
export function unaliasExternals(root: string, tag: string): number {
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
  say(tag, `${aliases.length} external aliases restored to their real names in ${rewritten} files (${aliases.map(([, r]) => r).join(", ")}).`);
  return rewritten;
}

/** esbuild, which comes with tsx (a dependency). */
export function esbuildOf(root: string): typeof import("esbuild") {
  const req = createRequire(path.join(root, "package.json"));
  return req(req.resolve("esbuild", { paths: [path.dirname(req.resolve("tsx/package.json"))] })) as typeof import("esbuild");
}

/** ⚠️ THE FINANCE MCP SERVER, BUNDLED. Subscription agents launch
    `lib/mcp/finance-server.ts`; from an installed package tsx cannot run it
    (it ignores the tsconfig `paths` under node_modules: "Cannot find module
    '@/lib/tools/registry'"), and every agent lost its BytNode-AI tools,
    silently. One ESM file: the `@/` aliases resolved now, every package
    left external (Node finds them in the shipped node_modules), a `require`
    for the CommonJS ones. `lib/mcp/server-launch.ts` launches it. */
export function bundleFinanceServer(root: string, tag: string): void {
  const outfile = path.join(root, SERVER_BUNDLE);
  const t0 = Date.now();
  esbuildOf(root).buildSync({
    entryPoints: [path.join(root, "lib", "mcp", "finance-server.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    tsconfig: path.join(root, "tsconfig.json"),
    outfile,
    logLevel: "warning",
    /* No absolute path of this machine in the output (checked after). */
    absWorkingDir: root,
    banner: { js: "import { createRequire as __bytnodeRequire } from 'node:module'; const require = __bytnodeRequire(import.meta.url);" },
  });
  say(tag, `finance MCP server bundled into ${SERVER_BUNDLE} in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

/** `required-server-files.json` carries the ABSOLUTE path of the project
    (`appDir`): the user name and the directory tree of the build machine.
    `next start` does not read this file (it serves hosting providers, in
    standalone mode); we blank the path, and the checks refuse the archive
    if it reappears or if another file mentions it. */
export function blankMachinePath(root: string): void {
  const rootJson = JSON.stringify(root).slice(1, -1);
  for (const name of ["required-server-files.json", "required-server-files.js"]) {
    const f = path.join(root, ".next", name);
    if (fs.existsSync(f)) fs.writeFileSync(f, fs.readFileSync(f, "utf8").split(rootJson).join("").split(root).join(""));
  }
}

/** The four steps, in order. */
export function releaseBuild(root: string, tag: string): void {
  cleanBuild(root, tag);
  unaliasExternals(root, tag);
  bundleFinanceServer(root, tag);
  blankMachinePath(root);
}
