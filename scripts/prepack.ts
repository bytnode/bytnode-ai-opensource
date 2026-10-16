/* Before `npm publish` / `npm pack`: clean build, cache removed, finance
   MCP server bundled, archive checked. Refuses to publish if a forbidden
   file or a key is in it, or if the bundle is missing.
   `--ignore-scripts` on the inner `npm pack`: otherwise prepack runs again.
   ⚠️ EVERYTHING HERE WRITES TO STDERR: npm runs this script with its own
   stdout, and `npm pack --json` must stay valid JSON (the Next banner and
   our lines used to come before it). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { containing, forbiddenPaths, isTextFile, leakedSecrets, machinePathNeedles, missingPaths } from "../lib/publish/pack-check";
import { releaseBuild } from "./release-build";

const root = process.cwd();

/* The build itself: `release-build.ts`. */
releaseBuild(root, "prepack");

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
