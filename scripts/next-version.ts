/* prepublishOnly: moves package.json (and the lockfile) past the versions
   already on npm, so `npm publish` never fails with "You cannot publish over
   the previously published versions". npm re-reads the manifest after this
   hook (lib/commands/publish.js), so the new number is the one sent.
   `npm publish --dry-run` only prints what it would do. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nextVersion } from "../lib/publish/next-version";

const root = process.cwd();
const pkgPath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name: string; version: string };

/* The npm running this hook (npm_execpath = its npm-cli.js): no shell, so no
   `.cmd` problem on Windows. */
function publishedVersions(name: string): string[] {
  const npmCli = process.env.npm_execpath;
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, "view", name, "versions", "--json"], { cwd: root, encoding: "utf8" })
    : spawnSync(`npm view ${name} versions --json`, { cwd: root, encoding: "utf8", shell: true });
  if (r.status !== 0) {
    if (/E404/.test(r.stdout + r.stderr)) return []; // never published
    console.error(`next-version: could not read the versions of ${name} on npm.\n${r.stderr}`);
    process.exit(1);
  }
  const out = JSON.parse(r.stdout || "[]") as string | string[];
  return Array.isArray(out) ? out : [out]; // a single version comes back as a string
}

function writeJson(file: string, edit: (json: Record<string, unknown>) => void) {
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(json);
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

let version: string;
try {
  version = nextVersion(pkg.version, publishedVersions(pkg.name));
} catch (e) {
  console.error(`next-version: ${(e as Error).message}`);
  process.exit(1);
}

if (version === pkg.version) {
  console.log(`next-version: ${version} is free on npm, kept.`);
} else if (process.env.npm_config_dry_run === "true") {
  console.log(`next-version: ${pkg.version} is taken on npm; a real publish would send ${version} (dry run, nothing written).`);
} else {
  writeJson(pkgPath, (json) => {
    json.version = version;
  });
  if (fs.existsSync(lockPath)) {
    writeJson(lockPath, (json) => {
      json.version = version;
      const self = (json.packages as Record<string, { version?: string }> | undefined)?.[""];
      if (self) self.version = version;
    });
  }
  console.log(`next-version: ${pkg.version} is taken on npm → publishing ${version} (package.json and package-lock.json updated).`);
}
