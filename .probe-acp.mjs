import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
/* Les agents installes par « Installer » (~/.bytnode-ai/agents/<id>/), comme
   l'app les lance : rien dans le node_modules du projet. */
const home = path.join(os.homedir(), ".bytnode-ai");
const agents = path.join(home, "agents");
const cwd = path.join(home, "workspaces", "_acp");
fs.mkdirSync(cwd, { recursive: true });
const [, , agent] = process.argv;
const L = {
  copilot: [path.join(agents, "copilot/node_modules/@github/copilot/npm-loader.js"), "--acp"],
  grok: [path.join(agents, "grok/node_modules/@xai-official/grok/bin/grok"), "agent", "stdio"],
  gemini: [path.join(agents, "gemini/node_modules/@google/gemini-cli/bundle/gemini.js"), "--acp"],
};
const env = { ...process.env, NO_COLOR: "1" }; for (const k of ["OPENAI_API_KEY","ANTHROPIC_API_KEY","XAI_API_KEY","GITHUB_TOKEN","GH_TOKEN"]) delete env[k];
const child = spawn(process.execPath, L[agent], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (b) => process.stderr.write("[stderr] " + String(b).slice(0, 300)));
child.on("exit", (c) => console.log("EXIT", c));
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
const conn = new acp.ClientSideConnection(() => ({ requestPermission: async () => ({ outcome: { outcome: "cancelled" } }), sessionUpdate: () => {} }), stream);
const t = setTimeout(() => { console.log("TIMEOUT"); child.kill(); process.exit(1); }, 40000);
try {
  const init = await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  console.log("INIT", JSON.stringify({ info: init.agentInfo, auth: init.authMethods, caps: init.agentCapabilities }).slice(0, 900));
  try {
    const s = await conn.newSession({ cwd, mcpServers: [] });
    console.log("SESSION", s.sessionId, JSON.stringify(s.configOptions ?? s.models ?? s.modes ?? null).slice(0, 1200));
  } catch (e) { console.log("SESSION-ERR", e?.message, JSON.stringify(e?.data ?? "").slice(0, 300)); }
} catch (e) { console.log("INIT-ERR", e?.message); }
clearTimeout(t); child.kill(); process.exit(0);
