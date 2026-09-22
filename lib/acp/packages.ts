import type { AcpAgentId } from "./agents";

/* ---------------------------------------------------------------------------
   Where each subscription agent comes from, and how we launch it.

   Nothing is bundled in BytNode-AI: « Install » puts an npm package (or a
   binary from the ACP registry) in `~/.bytnode-ai/agents/<id>/`, and three
   agents that speak ACP natively are also recognised if they are already
   on the PATH (`gemini`, `copilot`, `grok`). Claude and Codex always go
   through their adapter: it is the adapter that embeds the product.

   This file is shared browser / server: nothing from Node here.
--------------------------------------------------------------------------- */

export type NpmSource = {
  kind: "npm";
  pkg: string;
  /** `^x.y.z` range: raised by each version of BytNode-AI that needs a
      newer adapter (new models, efforts…). */
  version: string;
  /** Copied into the install package.json. The Claude SDK: without this
      override, the adapter pins an SDK 0.2 whose model list stops at
      Sonnet/Haiku/Opus. */
  overrides?: Record<string, string>;
  /** ACP entry point, relative to `node_modules/<pkg>`, and its arguments. */
  acp: { entry: string[]; args: string[] };
  /** The product's CLI (sign-in, account state), if it has one; `pkg` when
      it lives in another package (a dependency of the adapter). */
  cli?: { pkg?: string; entry: string[] };
  /** The same agent, already installed globally by the user. */
  global?: { command: string; args: string[] };
};

export type DownloadSource = {
  kind: "download";
  registryId: string;
  /** Executable name (`.exe` appended on Windows). */
  exe: string;
  fallback: Record<string, string>;
};

export type AgentSource = NpmSource | DownloadSource;

export const AGENT_SOURCES: Record<AcpAgentId, AgentSource> = {
  claude: {
    kind: "npm",
    pkg: "@zed-industries/claude-agent-acp",
    version: "^0.23.1",
    overrides: { "@anthropic-ai/claude-agent-sdk": "^0.3.270" },
    acp: { entry: ["dist", "index.js"], args: [] },
  },
  openai: {
    kind: "npm",
    pkg: "@agentclientprotocol/codex-acp",
    version: "^1.11.0",
    acp: { entry: ["dist", "index.js"], args: [] },
    cli: { pkg: "@openai/codex", entry: ["bin", "codex.js"] },
  },
  gemini: {
    kind: "npm",
    pkg: "@google/gemini-cli",
    version: "^0.59.0",
    acp: { entry: ["bundle", "gemini.js"], args: ["--acp"] },
    cli: { entry: ["bundle", "gemini.js"] },
    global: { command: "gemini", args: ["--acp"] },
  },
  copilot: {
    kind: "npm",
    pkg: "@github/copilot",
    version: "^1.0.83",
    acp: { entry: ["npm-loader.js"], args: ["--acp"] },
    cli: { entry: ["npm-loader.js"] },
    global: { command: "copilot", args: ["--acp"] },
  },
  grok: {
    kind: "npm",
    pkg: "@xai-official/grok",
    version: "^1.0.25",
    acp: { entry: ["bin", "grok"], args: ["agent", "stdio"] },
    cli: { entry: ["bin", "grok"] },
    global: { command: "grok", args: ["agent", "stdio"] },
  },
};

type InstallManifest = { private: true; dependencies: Record<string, string>; overrides?: Record<string, string> };

/** The package.json written into `~/.bytnode-ai/agents/<id>/` before `npm install`. */
export function installPackageJson(src: NpmSource): InstallManifest {
  const out: InstallManifest = { private: true, dependencies: { [src.pkg]: src.version } };
  if (src.overrides && Object.keys(src.overrides).length) out.overrides = src.overrides;
  return out;
}

const parse = (v: string): [number, number, number] | null => {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** Does `installed` satisfy the `^a.b.c` range? The bare minimum of
    semver (all our ranges are carets) — a pre-release `x.y.z-…` counts as
    lower than `x.y.z`. */
export function satisfiesCaret(installed: string, range: string): boolean {
  const min = parse(range.replace(/^\^/, ""));
  const got = parse(installed);
  if (!min || !got) return false;
  const pre = /^\d+\.\d+\.\d+-/.test(installed);
  const [a, b, c] = min;
  const [x, y, z] = got;
  if (x !== a) return false;
  if (a === 0 && y !== b) return false;
  const cmp = y !== b ? y - b : z - c;
  if (cmp !== 0) return cmp > 0;
  return !pre;
}
