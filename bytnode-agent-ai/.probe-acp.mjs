import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
const root = process.cwd();
const cwd = path.join(root, "workspaces", "_acp");
const [, , agent] = process.argv;
const L = {
  copilot: [path.join(root, "node_modules/@github/copilot/npm-loader.js"), "--acp"],
  grok: [path.join(root, "node_modules/@xai-official/grok/bin/grok"), "agent", "stdio"],
  qwen: [path.join(root, "node_modules/@qwen-code/qwen-code/cli-entry.js"), "--acp"],
};
const env = { ...process.env, NO_COLOR: "1" }; for (const k of ["OPENAI_API_KEY","ANTHROPIC_API_KEY","XAI_API_KEY","GITHUB_TOKEN","GH_TOKEN","QWEN_API_KEY"]) delete env[k];
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
