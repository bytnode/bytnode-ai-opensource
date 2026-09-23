import fs from "node:fs";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { describeRun, run } from "./run";
import { findOutsideReferences, outsideMessage } from "./guard";

/* ---------------------------------------------------------------------------
   Bash and PowerShell: one command, in the agent's workspace.

   The shell starts in that folder, with the user's environment. In the
   "workspace" scope, the command is read before being launched and refused
   when it designates an outside location (see `guard.ts`); it is a guard on
   the text, and the "ask before" mode remains the real safety net.

   On Windows, Bash is Git's; when it is missing, the tool says so instead
   of running on empty.
--------------------------------------------------------------------------- */

type Args = { command: string; timeout?: number; description?: string };

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;

const clampTimeout = (ms?: number) => Math.min(MAX_TIMEOUT, Math.max(1_000, ms ?? DEFAULT_TIMEOUT));

export function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function findPowerShell(): string {
  if (process.platform === "win32") {
    return fs.existsSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe") ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : "powershell.exe";
  }
  return "pwsh";
}

const timeoutParam = { type: "integer", description: "Time limit in milliseconds (default 120000, max 600000)." };
const descriptionParam = { type: "string", description: "What the command does, in a few words." };

/** The two shells, with the system's one declared as the default: on
    Windows PowerShell (native `C:\\…` paths), elsewhere Bash. The other
    stays available, but the model knows which one to pick first. */
export function makeShellTools(defaultShell: "Bash" | "PowerShell") {
  const bashNote =
    defaultShell === "Bash"
      ? "It is the default shell on this system."
      : "On this system (Windows) it is the SECONDARY shell: Git bash, Unix-style paths (`/c/Users/...`, not `C:\\`). Prefer PowerShell unless you need Unix tools (grep, sed, awk, pipes).";
  const psNote =
    defaultShell === "PowerShell"
      ? "It is the DEFAULT shell on this system (Windows): native `C:\\...` paths, Get-ChildItem, Get-Content commands, etc."
      : "On this system it is the secondary shell (pwsh); prefer Bash.";
  return {
    bashTool: { ...bashTool, description: `${bashTool.description} ${bashNote}` },
    powershellTool: { ...powershellTool, description: `${powershellTool.description} ${psNote}` },
  };
}

export const bashTool: Tool<Args> = {
  name: "Bash",
  policy: { gated: true, subagent: true },
  description:
    "Runs a shell command (bash) in the workspace and returns its output. To read, search or modify files, prefer Read, Glob, Grep and Edit. No interactive command.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "The command." }, timeout: timeoutParam, description: descriptionParam },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const bash = findBash();
    if (!bash) return fail("No bash found on this machine (Git for Windows is not installed). Use PowerShell.");
    if (ctx.scope === "workspace") {
      const refs = findOutsideReferences(args.command, ctx.workspace);
      if (refs.length) return fail(outsideMessage(refs));
    }
    try {
      const r = await run(bash, ["-lc", args.command], {
        cwd: ctx.workspace,
        timeoutMs: clampTimeout(args.timeout),
        signal: ctx.signal,
        env: { MSYS: "winsymlinks:nativestrict", MSYS_NO_PATHCONV: "1" },
      });
      return (r.code === 0 && !r.timedOut && !r.aborted ? ok : fail)(describeRun(r, "bash"));
    } catch (e) {
      return fail(`Bash failed: ${errorText(e)}`);
    }
  },
};

export const powershellTool: Tool<Args> = {
  name: "PowerShell",
  policy: { gated: true, subagent: true },
  description:
    "Runs a PowerShell command in the workspace and returns its output. Native on Windows (pwsh 7 when present, otherwise Windows PowerShell). No interactive command.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "The command." }, timeout: timeoutParam, description: descriptionParam },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.scope === "workspace") {
      const refs = findOutsideReferences(args.command, ctx.workspace);
      if (refs.length) return fail(outsideMessage(refs));
    }
    try {
      const r = await run(findPowerShell(), ["-NoProfile", "-NonInteractive", "-Command", args.command], {
        cwd: ctx.workspace,
        timeoutMs: clampTimeout(args.timeout),
        signal: ctx.signal,
      });
      return (r.code === 0 && !r.timedOut && !r.aborted ? ok : fail)(describeRun(r, "PowerShell"));
    } catch (e) {
      return fail(`PowerShell failed: ${errorText(e)}`);
    }
  },
};
