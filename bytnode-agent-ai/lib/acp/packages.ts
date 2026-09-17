import type { AcpAgentId } from "./agents";

/* ---------------------------------------------------------------------------
   D'ou vient chaque agent par abonnement, et comment on le lance.

   Rien n'est embarque dans BytNode-AI : « Installer » pose un paquet npm
   (ou un binaire du registre ACP) dans `~/.bytnode-ai/agents/<id>/`, et
   trois agents qui parlent ACP nativement sont aussi reconnus s'ils sont
   deja sur le PATH (`gemini`, `copilot`, `grok`). Claude et Codex passent
   toujours par leur adaptateur : c'est lui qui embarque le produit.

   Ce fichier est partage navigateur / serveur : rien de Node ici.
--------------------------------------------------------------------------- */

export type NpmSource = {
  kind: "npm";
  pkg: string;
  /** Plage `^x.y.z` : relevee a chaque version de BytNode-AI qui a besoin
      d'un adaptateur plus recent (nouveaux modeles, efforts…). */
  version: string;
  /** Repris dans le package.json d'installation. Le SDK Claude : sans cet
      override, l'adaptateur epingle un SDK 0.2 dont la liste des modeles
      s'arrete a Sonnet/Haiku/Opus. */
  overrides?: Record<string, string>;
  /** Point d'entree ACP, relatif a `node_modules/<pkg>`, et ses arguments. */
  acp: { entry: string[]; args: string[] };
  /** Le CLI du produit (connexion, etat du compte), s'il en a un ; `pkg`
      quand il vit dans un autre paquet (dependance de l'adaptateur). */
  cli?: { pkg?: string; entry: string[] };
  /** Le meme agent, deja installe globalement par l'utilisateur. */
  global?: { command: string; args: string[] };
};

export type DownloadSource = {
  kind: "download";
  registryId: string;
  /** Nom de l'executable (`.exe` ajoute sous Windows). */
  exe: string;
  fallback: Record<string, string>;
};

export type AgentSource = NpmSource | DownloadSource;

const MISTRAL = "https://github.com/mistralai/mistral-vibe/releases/download/v2.24.1";

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
  mistral: {
    kind: "download",
    registryId: "mistral-vibe",
    exe: "vibe-acp",
    fallback: {
      "windows-x86_64": `${MISTRAL}/vibe-acp-windows-x86_64-2.24.1.zip`,
      "darwin-aarch64": `${MISTRAL}/vibe-acp-darwin-aarch64-2.24.1.tar.gz`,
      "darwin-x86_64": `${MISTRAL}/vibe-acp-darwin-x86_64-2.24.1.tar.gz`,
      "linux-x86_64": `${MISTRAL}/vibe-acp-linux-x86_64-2.24.1.tar.gz`,
      "linux-aarch64": `${MISTRAL}/vibe-acp-linux-aarch64-2.24.1.tar.gz`,
    },
  },
};

type InstallManifest = { private: true; dependencies: Record<string, string>; overrides?: Record<string, string> };

/** Le package.json ecrit dans `~/.bytnode-ai/agents/<id>/` avant `npm install`. */
export function installPackageJson(src: NpmSource): InstallManifest {
  const out: InstallManifest = { private: true, dependencies: { [src.pkg]: src.version } };
  if (src.overrides && Object.keys(src.overrides).length) out.overrides = src.overrides;
  return out;
}

const parse = (v: string): [number, number, number] | null => {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** `installed` satisfait-il la plage `^a.b.c` ? Le strict necessaire de
    semver (nos plages sont toutes des carets) — une preversion `x.y.z-…`
    compte comme inferieure a `x.y.z`. */
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
