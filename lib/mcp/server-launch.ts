import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/* ---------------------------------------------------------------------------
   How the finance MCP server (`finance-server.ts`) is launched for a
   subscription agent.

   ⚠️ FROM AN INSTALLED PACKAGE, tsx CANNOT RUN IT: tsx does not apply the
   tsconfig `paths` to files under `node_modules` (its `isDependencyPath`),
   and an installed package always lives under node_modules — every `@/`
   import failed ("Cannot find module '@/lib/tools/registry'") and every
   subscription agent started from npm had NO BytNode-AI tool, silently.
   So `prepack` bundles the server into one ESM file (aliases resolved at
   build time, every package left external, `scripts/prepack.ts`), shipped
   at `SERVER_BUNDLE`; the app launches that bundle, and tsx on the source
   in development — where the code changes under our feet.
--------------------------------------------------------------------------- */

/** The bundled server, relative to the package root. Under `.next`: a
    build artefact, shipped by `files`, ignored by git. */
export const SERVER_BUNDLE = path.join(".next", "finance-server.mjs");

/** Launch the bundle? Only in production (`next start`; `next dev` runs
    the source), and only if it is not older than the build it sits in: a
    bundle left by an old `npm pack` in the repo would serve old tools
    after a new `next build`. npm stamps every file of a package with the
    same date, so an installed bundle is never "older". Pure. */
export function bundleIsUsable(o: { production: boolean; bundleMtime: number | null; buildMtime: number | null }): boolean {
  if (!o.production || o.bundleMtime === null) return false;
  /* A second of slack: the build and the bundle are written by the same
     prepack, and some file systems round mtimes. */
  return o.buildMtime === null || o.bundleMtime + 1000 >= o.buildMtime;
}

const mtime = (file: string): number | null => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** tsx's CLI, resolved the way Node resolves it from the project.
    ⚠️ NEVER `<project>/node_modules/tsx`: under `npx bytnode-ai` (and any
    local install) npm hoists tsx NEXT TO the package, `bytnode-ai` has no
    `node_modules` of its own, and every subscription agent lost its
    BytNode-AI tools ("Cannot find module …/tsx/dist/cli.mjs"). */
export function tsxCli(root: string): string {
  try {
    return createRequire(path.join(root, "package.json")).resolve("tsx/cli");
  } catch {
    return path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  }
}

/** The arguments for `node`: the bundle when `bundleIsUsable` says so,
    otherwise tsx on the source with the project's tsconfig — explicitly:
    the agent launches the server in the workspace, and the `@/` aliases
    must resolve from the project, not from where the process starts. */
export function financeServerArgs(root: string, production = process.env.NODE_ENV === "production"): string[] {
  const bundle = path.join(root, SERVER_BUNDLE);
  if (bundleIsUsable({ production, bundleMtime: mtime(bundle), buildMtime: mtime(path.join(root, ".next", "BUILD_ID")) })) return [bundle];
  return [tsxCli(root), "--tsconfig", path.join(root, "tsconfig.json"), path.join(root, "lib", "mcp", "finance-server.ts")];
}
