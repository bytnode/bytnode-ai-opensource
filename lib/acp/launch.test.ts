import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentDir, appleScriptString, brokenInstall, launchFile, linuxTerminal, npmCli, posixTerminalLine } from "./launch";

const has =
  (...present: string[]) =>
  (p: string) =>
    present.includes(p);

describe("brokenInstall", () => {
  const dir = agentDir("claude");
  const nm = path.join(dir, "node_modules");
  const lock = path.join(dir, "package-lock.json");
  const adapter = path.join(nm, "@zed-industries", "claude-agent-acp", "dist", "index.js");
  const sdk = path.join(nm, "@anthropic-ai", "claude-agent-sdk", "cli.js");

  it("flags a node_modules without package-lock: npm was interrupted", () => {
    expect(brokenInstall("claude", has(nm, adapter, sdk))).toMatch(/Incomplete/);
  });
  it("accepts a finished installation, or none", () => {
    expect(brokenInstall("claude", has(nm, lock, adapter, sdk))).toBeNull();
    expect(brokenInstall("claude", has())).toBeNull();
  });
  /* 2026-10-04: an update failed midway, the old lock stayed, the SDK's
     folders were empty — and « Sign in » ran a cli.js that was gone. */
  it("flags an install whose lock survived but whose files did not", () => {
    expect(brokenInstall("claude", has(nm, lock, adapter))).toMatch(/Incomplete/);
    expect(brokenInstall("claude", has(nm, lock, sdk))).toMatch(/Incomplete/);
  });
});

describe("npmCli (windows)", () => {
  const win = { platform: "win32" as NodeJS.Platform, env: { PATHEXT: ".COM;.EXE;.CMD" } };

  it("takes the npm the desktop app ships first", () => {
    const execPath = "C:\\Users\\u\\AppData\\Local\\Programs\\BytNode-AI\\BytNode-AI.exe";
    const shipped = "C:\\Users\\u\\AppData\\Local\\Programs\\BytNode-AI\\resources\\npm\\bin\\npm-cli.js";
    const env = { ...win.env, BYTNODE_AI_NPM_CLI: shipped };
    expect(npmCli({ ...win, env, execPath, exists: has(shipped) })).toEqual({ command: execPath, args: [shipped] });
    /* Gone (a broken install): the usual search. */
    expect(npmCli({ ...win, env, execPath, exists: has() })).toEqual({ command: "npm", args: [], shell: true });
  });

  it("takes the npm-cli.js next to node (official installer)", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const script = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    expect(npmCli({ ...win, execPath, exists: has(script) })).toEqual({ command: execPath, args: [script] });
  });

  it("takes the global prefix when node has no npm beside it", () => {
    const execPath = "C:\\Users\\u\\scoop\\apps\\nodejs\\current\\node.exe";
    const script = "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js";
    const env = { ...win.env, APPDATA: "C:\\Users\\u\\AppData\\Roaming" };
    expect(npmCli({ ...win, env, execPath, exists: has(script) })).toEqual({ command: execPath, args: [script] });
  });

  it("takes the npm-cli.js beside the npm found on the PATH", () => {
    const execPath = "C:\\Users\\u\\AppData\\Local\\fnm\\node.exe";
    const dir = "C:\\Program Files\\nodejs";
    const script = path.win32.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    const env = { ...win.env, Path: dir };
    expect(npmCli({ ...win, env, execPath, exists: has(path.win32.join(dir, "npm.CMD"), script) })).toEqual({ command: execPath, args: [script] });
  });

  /* The reported bug: a shim-based install (Volta, nvs, Microsoft Store)
     has no npm-cli.js anywhere, yet npm works. This used to throw
     « npm not found next to Node », ending « Install ». */
  it("falls back to the npm command when no script exists, shim install", () => {
    const bin = "C:\\Users\\u\\AppData\\Local\\Volta\\bin";
    const env = { ...win.env, Path: bin };
    const r = npmCli({ ...win, env, execPath: path.win32.join(bin, "node.exe"), exists: has(path.win32.join(bin, "npm.EXE")) });
    expect(r).toEqual({ command: "npm", args: [], shell: true });
  });

  it("falls back to the npm command when nothing is found at all", () => {
    expect(npmCli({ ...win, execPath: "C:\\x\\node.exe", exists: has() })).toEqual({ command: "npm", args: [], shell: true });
  });

  /* `shell` leaves the command unquoted: a resolved `C:\Program Files\…`
     would split on the space, so the fallback passes the bare name. */
  it("never pairs shell with a resolved path", () => {
    const bin = "C:\\Program Files\\nodejs";
    const env = { ...win.env, Path: bin };
    const r = npmCli({ ...win, env, execPath: "C:\\shim\\node.exe", exists: has(path.win32.join(bin, "npm.CMD")) });
    expect(r.shell ? r.command : "npm").toBe("npm");
  });
});

describe("npmCli (posix)", () => {
  const posix = { platform: "linux" as NodeJS.Platform, env: {} };

  it("takes the npm-cli.js under the node prefix", () => {
    const script = "/usr/local/lib/node_modules/npm/bin/npm-cli.js";
    expect(npmCli({ ...posix, execPath: "/usr/local/bin/node", exists: has(script) })).toEqual({ command: "/usr/local/bin/node", args: [script] });
  });

  it("takes the libexec layout (homebrew cellar)", () => {
    const execPath = "/opt/homebrew/Cellar/node/24.0.0/bin/node";
    const script = "/opt/homebrew/Cellar/node/24.0.0/libexec/lib/node_modules/npm/bin/npm-cli.js";
    expect(npmCli({ ...posix, execPath, exists: has(script) })).toEqual({ command: execPath, args: [script] });
  });

  it("runs the npm found on the PATH directly, no shell", () => {
    const env = { PATH: "/usr/bin" };
    expect(npmCli({ ...posix, env, execPath: "/opt/x/bin/node", exists: has("/usr/bin/npm") })).toEqual({ command: "/usr/bin/npm", args: [] });
  });

  it("falls back to the npm command, still no shell", () => {
    expect(npmCli({ ...posix, execPath: "/opt/x/bin/node", exists: has() })).toEqual({ command: "npm", args: [], shell: false });
  });
});

/* Grok's `bin/grok` is a Node script on Windows and, after its postinstall
   on macOS / Linux, a symlink to a native binary. */
describe("launchFile", () => {
  const bin = "/home/me/.bytnode-ai/agents/grok/node_modules/@xai-official/grok/bin/grok";

  it("a Node script runs with this Node", () => {
    expect(launchFile(bin, ["agent", "stdio"], "#!/usr/bin/env node\n// …")).toEqual({ command: process.execPath, args: [bin, "agent", "stdio"] });
    expect(launchFile("/x/npm-loader.js", ["--acp"], "")).toEqual({ command: process.execPath, args: ["/x/npm-loader.js", "--acp"] });
  });

  it("a native binary (ELF, Mach-O, PE) runs as itself", () => {
    for (const head of ["\x7fELF\x02\x01", "\xcf\xfa\xed\xfe\x0c", "\xca\xfe\xba\xbe", "MZ\x90\x00"]) {
      expect(launchFile(bin, ["agent", "stdio"], head)).toEqual({ command: bin, args: ["agent", "stdio"] });
    }
  });

  it("a script for another interpreter runs through its own shebang", () => {
    expect(launchFile(bin, [], "#!/bin/sh\nexec x")).toEqual({ command: bin, args: [] });
  });
});

describe("the sign-in terminal, macOS / Linux", () => {
  it("writes the environment into the line: keys removed, the agent's own variables kept", () => {
    const line = posixTerminalLine("/opt/grok", ["login"], { GROK_MODE: "it's" });
    expect(line).toMatch(/^env -u ANTHROPIC_API_KEY /);
    expect(line).toContain("-u XAI_API_KEY");
    expect(line).toContain(`'GROK_MODE=it'\\''s' '/opt/grok' 'login';`);
  });

  it("keeps the desktop app's binary a Node in the terminal", () => {
    expect(posixTerminalLine("/Applications/BytNode-AI.app/Contents/MacOS/BytNode-AI", ["cli.js"], {}, true)).toContain("FORCE_COLOR=0 ELECTRON_RUN_AS_NODE=1 '/Applications/");
    expect(posixTerminalLine("/usr/bin/node", ["cli.js"], {}, false)).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("quotes an AppleScript string", () => {
    expect(appleScriptString(`a "b" c\\d`)).toBe(`"a \\"b\\" c\\\\d"`);
  });

  it("takes the first terminal installed, each with its own way of taking a command", () => {
    const only = (name: string) => (n: string) => (n === name ? `/usr/bin/${name}` : null);
    expect(linuxTerminal("x", only("gnome-terminal"))).toEqual({ command: "/usr/bin/gnome-terminal", args: ["--", "sh", "-c", "x"] });
    expect(linuxTerminal("x", only("konsole"))).toEqual({ command: "/usr/bin/konsole", args: ["-e", "sh", "-c", "x"] });
    expect(linuxTerminal("x", () => null)).toBeNull();
  });
});
