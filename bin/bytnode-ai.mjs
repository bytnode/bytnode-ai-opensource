#!/usr/bin/env node
/* Le lanceur de `npx bytnode-ai` : verifie Node, trouve un port, demarre
   `next start` DANS LE DOSSIER DU PAQUET (PROJECT_ROOT = process.cwd()
   partout dans l'app), attend que le serveur reponde, ouvre le navigateur.
   Node pur, sans dependance : ce fichier tourne avant tout le reste. */
import { spawn } from "node:child_process";
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
    `bytnode-ai ${version}\n\n  npx bytnode-ai [--port 3777] [--no-open]\n\n  --port N     port du serveur local (defaut 3777)\n  --no-open    ne pas ouvrir le navigateur\n\nDonnees : ~/.bytnode-ai (BYTNODE_AI_HOME pour changer).`,
  );
  process.exit(0);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`Node 20.9 ou plus est requis (vous avez ${process.versions.node}). https://nodejs.org`);
  process.exit(1);
}

const port = Number(value("--port", "3777"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Port invalide : ${value("--port", "")}`);
  process.exit(1);
}

const free = await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
});
if (!free) {
  console.error(`Le port ${port} est occupé. Relancez avec --port ${port + 1}.`);
  process.exit(1);
}

console.log(`BytNode-AI ${version}`);
const next = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
const child = spawn(process.execPath, [next, "start", "--port", String(port)], {
  cwd: pkgDir,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

const url = `http://localhost:${port}`;
const deadline = Date.now() + 60_000;
let up = false;
while (!up && Date.now() < deadline && child.exitCode === null) {
  try {
    up = (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!up) {
  console.error(`Le serveur ne répond pas sur ${url}.`);
} else if (!flag("--no-open")) {
  const open = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(open[0], open[1], { detached: true, stdio: "ignore" })
    .on("error", () => {})
    .unref();
  console.log(`Ouvert : ${url}   (Ctrl-C pour arrêter)`);
} else console.log(`Prêt : ${url}   (Ctrl-C pour arrêter)`);
