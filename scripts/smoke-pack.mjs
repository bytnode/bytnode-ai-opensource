/* The package as a user receives it: `npm pack`, install the .tgz in a
   temporary folder, `bytnode-ai --no-open`, then the checks that matter —
   the page answers, the tools and professions load from the package, the
   data folder is the one from BYTNODE_AI_HOME, and the finance MCP server
   that subscription agents launch starts FROM THE INSTALLED PACKAGE and
   lists its tools (it could not, and nothing caught it: tsx cannot run the
   TypeScript source under node_modules — `lib/mcp/server-launch.ts`).
   `npm pack --json` must be valid JSON (prepack writes to stderr). No key,
   no agent: zero tokens. `npm run smoke:pack`. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const shell = process.platform === "win32";
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", shell });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: exit code ${r.status}`);
  return r.stdout.trim();
};

/* Parsed whole: a build log before the JSON is a failure. */
const packed = sh("npm", ["pack", "--json"], root);
let tgz;
try {
  tgz = path.join(root, JSON.parse(packed)[0].filename);
} catch {
  throw new Error(`npm pack --json is not valid JSON:\n${packed.slice(0, 400)}`);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bytnode-ai-smoke-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home);
try {
  sh("npm", ["init", "-y"], tmp);
  sh("npm", ["install", "--no-audit", "--no-fund", tgz], tmp);
  const bin = path.join(tmp, "node_modules", "bytnode-ai", "bin", "bytnode-ai.mjs");
  const port = 3790 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, [bin, "--port", String(port), "--no-open"], { stdio: "inherit", env: { ...process.env, BYTNODE_AI_HOME: home } });
  try {
    /* The server binds 127.0.0.1 only (bin/bytnode-ai.mjs): probe that
       address, not `localhost`, which Windows resolves to ::1 first. */
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90_000;
    let ok = false;
    while (!ok && Date.now() < deadline) {
      try {
        ok = (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ok) throw new Error("the page is not answering");
    const tools = await fetch(`${url}/api/tools?profession=standard&agentId=smoke`);
    if (!tools.ok) throw new Error(`/api/tools: ${tools.status}`);
    const body = await tools.json();
    const names = (body.tools ?? []).map((t) => t.function?.name);
    if (!names.includes("Skill") || !names.includes("Read")) throw new Error(`/api/tools does not list the tools: ${names.join(", ")}`);
    const expected = path.join(home, "workspaces", "smoke");
    if (path.resolve(body.workspace) !== expected || !fs.existsSync(expected)) throw new Error(`unexpected workspace: ${body.workspace}`);
    const mcp = await financeServerTools(path.join(tmp, "node_modules", "bytnode-ai"), home);
    console.log(`smoke: OK (${path.basename(tgz)}, port ${port}, ${names.length} tools, ${mcp.length} MCP tools, data in ${home})`);
  } finally {
    await stop(child);
  }
} finally {
  /* Windows keeps a folder busy for a moment after its processes exit. */
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  fs.rmSync(tgz, { force: true });
}

/** Starts the bundled finance MCP server from the installed package, as a
    subscription agent would (`sessions.ts` → `financeServerArgs`, which
    picks this bundle under `next start`), and lists its tools. */
async function financeServerTools(pkg, home) {
  const bundle = path.join(pkg, ".next", "finance-server.mjs");
  if (!fs.existsSync(bundle)) throw new Error(`the package has no ${path.relative(pkg, bundle)}`);
  const workspace = path.join(home, "workspaces", "smoke");
  fs.mkdirSync(workspace, { recursive: true });
  const child = spawn(process.execPath, [bundle], {
    cwd: workspace,
    env: { ...process.env, BYTNODE_AI_WORKSPACE: workspace, BYTNODE_AI_PROJECT_ROOT: pkg, BYTNODE_AI_HOME: home, BYTNODE_AI_DEPTH: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  let buf = "";
  const waits = new Map();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(line);
        waits.get(msg.id)?.(msg);
      } catch {
        /* not a JSON-RPC line */
      }
    }
  });
  let id = 0;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waits.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
      setTimeout(() => reject(new Error(`the finance MCP server did not answer ${method} in 60 s${err ? `:\n${err.slice(0, 800)}` : ""}`)), 60_000).unref();
    });
  const exited = new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`the finance MCP server exited (${code}):\n${err.slice(0, 800)}`))));
  try {
    await Promise.race([rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } }), exited]);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await Promise.race([rpc("tools/list", {}), exited]);
    const names = (list.result?.tools ?? []).map((t) => t.name);
    for (const expected of ["Memory", "PositionSize"]) {
      if (!names.includes(expected)) throw new Error(`the finance MCP server does not list ${expected}: ${names.join(", ")}`);
    }
    return names;
  } finally {
    child.removeAllListeners("exit");
    await stop(child);
  }
}

/** Kills a child and waits for it to be gone (at most 10 s): its folder
    can only be removed after that. */
function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(resolve, 10_000).unref();
    child.kill();
  });
}
