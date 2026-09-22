#!/usr/bin/env node
/* The launcher: checks Node, finds a port, starts `next start` IN THE
   PACKAGE DIRECTORY (PROJECT_ROOT = process.cwd() everywhere in the app),
   waits for the server to answer, opens the browser. `npx bytnode-ai` is
   the INSTALL step: run from the npx cache, it first installs the
   `bytnode-ai` command (npm install -g, same version); after that the
   user types `bytnode-ai`, and `npx bytnode-ai@latest` updates.
   Plain Node, no dependency: this file runs before everything else. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = require(path.join(pkgDir, "package.json"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--version") || flag("-v")) {
  console.log(version);
  process.exit(0);
}
if (flag("--help") || flag("-h")) {
  console.log(
    `bytnode-ai ${version}\n\n  npx bytnode-ai            installs the bytnode-ai command, then starts the app\n  bytnode-ai                starts the app (every time after that)\n  npx bytnode-ai@latest     updates\n\n  --port N       local server port (default 3777)\n  --no-open      do not open the browser\n  --no-install   (npx) do not install the command\n\nData: ~/.bytnode-ai (BYTNODE_AI_HOME to change it).`,
  );
  process.exit(0);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`Node 20.9 or newer is required (you have ${process.versions.node}). https://nodejs.org`);
  process.exit(1);
}

/* Run through `npx`: the package lives in the npx cache
   (~/.npm/_npx/<hash>/node_modules/bytnode-ai), not on the PATH. We install
   the command from the registry (not a link to that cache, which npm may
   clear), unless it is already there in this version. A failure (rights on
   the global prefix, network) does not stop the app from starting. */
if (/[\\/]_npx[\\/]/.test(pkgDir) && !flag("--no-install")) {
  const npm = npmCli();
  const globalRoot = spawnSync(npm.command, [...npm.args, "root", "-g"], { encoding: "utf8", shell: npm.shell }).stdout?.trim();
  const globalPkg = globalRoot && path.join(globalRoot, "bytnode-ai", "package.json");
  const installed = globalPkg && fs.existsSync(globalPkg) ? require(globalPkg).version : null;
  if (installed === version) {
    console.log(`The bytnode-ai command (${version}) is already installed: just type bytnode-ai.`);
  } else {
    console.log(`Installing the bytnode-ai command (${version})… (about 1 min)`);
    const r = spawnSync(npm.command, [...npm.args, "install", "-g", `bytnode-ai@${version}`, "--no-audit", "--no-fund", "--loglevel=error"], { stdio: "inherit", shell: npm.shell });
    if (r.status === 0) console.log("Installed: from now on, just type bytnode-ai to start the app (npx bytnode-ai@latest to update).");
    else {
      const hint = process.platform === "win32" ? "" : " — no rights on the global folder? try: sudo npm install -g bytnode-ai";
      console.error(`The command could not be installed (npm install -g failed${hint}). The app starts anyway; run it again with npx bytnode-ai.`);
    }
  }
}

function npmCli() {
  const nodeDir = path.dirname(process.execPath);
  const cli = process.platform === "win32" ? path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js") : path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(cli)) return { command: process.execPath, args: [cli], shell: false };
  return { command: "npm", args: [], shell: process.platform === "win32" };
}

const port = Number(value("--port", "3777"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${value("--port", "")}`);
  process.exit(1);
}

const free = await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
});
if (!free) {
  console.error(`Port ${port} is busy. Run again with --port ${port + 1}.`);
  process.exit(1);
}

console.log(`BytNode-AI ${version}`);
const next = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
/* ⚠️ LOOPBACK ONLY. Without `--hostname`, Next listens on 0.0.0.0: the app
   — and with it /api/tools/execute, a shell on this machine with no login —
   was reachable from every device on the same network. `proxy.ts` cannot
   help there: a remote browser navigating straight to http://<ip>:<port>
   is a same-origin visitor to it. */
const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: pkgDir,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

const url = `http://localhost:${port}`;
/* The readiness probe hits the address we bound, not `localhost`, which
   Windows resolves to ::1 first. */
const probe = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 60_000;
let up = false;
while (!up && Date.now() < deadline && child.exitCode === null) {
  try {
    up = (await fetch(probe, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!up) {
  console.error(`The server is not answering on ${url}.`);
} else if (!flag("--no-open")) {
  const open = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(open[0], open[1], { detached: true, stdio: "ignore" })
    .on("error", () => {})
    .unref();
  console.log(`Opened: ${url}   (Ctrl-C to stop)`);
} else console.log(`Ready: ${url}   (Ctrl-C to stop)`);
