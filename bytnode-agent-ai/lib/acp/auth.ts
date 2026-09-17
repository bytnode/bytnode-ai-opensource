import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuthMethod } from "@agentclientprotocol/sdk";
import {
  ACP_AGENTS,
  acpAgentInfo,
  type AcpAgentId,
  type AcpAuthStatus,
} from "./agents";
import { AcpConnection } from "./connection";
import { installFailure, isInstalling } from "./install";
import {
  acpLaunch,
  cliLaunch,
  installedVersion,
  isInstalled,
  openTerminal,
  resolveAcp,
  openTerminalWith,
  runCli,
  subscriptionEnv,
} from "./launch";
import { AGENT_SOURCES, satisfiesCaret } from "./packages";
import { prepareWorkspace, scratchWorkspace } from "./prepare";

/* ---------------------------------------------------------------------------
   Le compte derriere chaque agent : connecte ou non, se connecter, se
   deconnecter.

   Trois agents ont un CLI qui repond vite (Claude : `auth status` en JSON ;
   Codex : `login status` ; Gemini : un fichier de creances). Les autres
   passent par le protocole lui-meme : une session d'essai qui reussit =
   connecte, une erreur « authentification requise » = pas connecte ; pour
   se connecter, la methode que l'agent annonce a `initialize` — soit il
   ouvre le navigateur lui-meme (`authenticate`), soit il demande un
   terminal (`copilot login`). Le reste de l'application ne voit que
   `AcpAuthStatus`.
--------------------------------------------------------------------------- */

const CONNECTING_TTL = 10 * 60_000;
const connecting = new Map<AcpAgentId, number>();

const isConnecting = (agent: AcpAgentId) => {
  const since = connecting.get(agent);
  if (since === undefined) return false;
  if (Date.now() - since > CONNECTING_TTL) {
    connecting.delete(agent);
    return false;
  }
  return true;
};

export async function authStatus(agent: AcpAgentId): Promise<AcpAuthStatus> {
  const resolved = resolveAcp(agent);
  if (!resolved) {
    return { agent, available: false, installing: isInstalling(agent), loggedIn: false, message: installFailure(agent) };
  }
  const base = await (STATUS[agent] ?? genericStatus(agent))();
  const status: AcpAuthStatus = { agent, available: true, source: resolved.source, outdated: isOutdated(agent), ...base };
  if (status.loggedIn) connecting.delete(agent);
  else status.connecting = isConnecting(agent);
  return status;
}

/* La plage attendue a ete relevee par une version de BytNode-AI (nouveaux
   modeles, efforts) : le bouton devient « Mettre a jour ». */
const isOutdated = (agent: AcpAgentId): boolean => {
  const src = AGENT_SOURCES[agent];
  const got = installedVersion(agent);
  return src.kind === "npm" && got !== null && !satisfiesCaret(got, src.version);
};

export const allAuthStatus = () =>
  Promise.all(ACP_AGENTS.map((a) => authStatus(a.id)));

type Partial_ = {
  loggedIn: boolean;
  account?: string | null;
  message?: string | null;
  checking?: boolean;
};

const STATUS: Partial<Record<AcpAgentId, () => Promise<Partial_>>> = {
  async claude() {
    const { out } = await runCli("claude", ["auth", "status"]);
    const json = out.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return { loggedIn: false, message: out.trim() || null };
    try {
      const s = JSON.parse(json) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
        authMethod?: string;
      };
      const plan = s.subscriptionType ? ` · ${s.subscriptionType}` : "";
      return {
        loggedIn: !!s.loggedIn,
        account: s.loggedIn
          ? `${s.email ?? s.authMethod ?? "compte"}${plan}`
          : null,
      };
    } catch {
      return { loggedIn: false, message: "Réponse illisible de Claude Code." };
    }
  },
  async openai() {
    const { out } = await runCli("openai", ["login", "status"]);
    const text = out.trim();
    if (/not logged in/i.test(text)) return { loggedIn: false };
    if (/logged in/i.test(text))
      return {
        loggedIn: true,
        account: text.replace(/^logged in\s*/i, "") || "ChatGPT",
      };
    return { loggedIn: false, message: text || null };
  },
  async gemini() {
    try {
      await fs.access(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
      return { loggedIn: true, account: "Compte Google" };
    } catch {
      return { loggedIn: false };
    }
  },
};

/* --- Par le protocole ----------------------------------------------------- */

const PROBE_TTL = 90_000;
/* Un agent qui ne repond pas a `session/new` (il attend une connexion
   interactive, il est bloque) ne doit pas laisser l'etat a « vérification »
   pour toujours. */
const PROBE_TIMEOUT = 45_000;
const probeCache = new Map<AcpAgentId, { at: number; result: Partial_ }>();
const probeInflight = new Map<AcpAgentId, Promise<Partial_>>();

export const forgetStatus = (agent: AcpAgentId) => probeCache.delete(agent);

const looksLikeAuth = (msg: string) =>
  /auth|api key|sign in|log ?in|credential/i.test(msg);

/* ⚠️ ON NE FAIT PAS ATTENDRE LA PAGE. Interroger un agent par le protocole
   coute quelques secondes (un sous-processus a lancer) : la premiere lecture
   rend « en cours » et la vraie reponse arrive en arriere-plan ; ensuite le
   cache repond tout de suite, et une valeur perimee est servie telle quelle
   pendant qu'on la rafraichit. */
function genericStatus(agent: AcpAgentId): () => Promise<Partial_> {
  return async () => {
    const hit = probeCache.get(agent);
    if (hit) {
      if (Date.now() - hit.at >= PROBE_TTL) void probe(agent);
      return hit.result;
    }
    void probe(agent);
    return { loggedIn: false, checking: true };
  };
}

function probe(agent: AcpAgentId): Promise<Partial_> {
  const running = probeInflight.get(agent);
  if (running) return running;
  const p = (async (): Promise<Partial_> => {
    let result: Partial_;
    try {
      const cwd = await scratchWorkspace();
      await prepareWorkspace(agent, cwd);
      const conn = await AcpConnection.open(agent, cwd);
      try {
        await Promise.race([
          conn.newSession(cwd, []),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("L'agent ne répond pas.")), PROBE_TIMEOUT).unref()),
        ]);
        result = { loggedIn: true, account: acpAgentInfo(agent).plan };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = looksLikeAuth(msg)
          ? { loggedIn: false }
          : { loggedIn: false, message: msg };
      } finally {
        conn.close();
      }
    } catch (e) {
      result = {
        loggedIn: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
    probeCache.set(agent, { at: Date.now(), result });
    return result;
  })();
  probeInflight.set(agent, p);
  p.finally(() => probeInflight.delete(agent));
  return p;
}

/** Demarre la connexion et rend la main : l'etat se lit ensuite en
    interrogeant `authStatus` jusqu'a ce qu'il dise « connecté ». */
export async function startLogin(agent: AcpAgentId): Promise<void> {
  if (!isInstalled(agent))
    throw new Error("Agent absent : installez-le d'abord.");
  connecting.set(agent, Date.now());
  probeCache.delete(agent);
  await (LOGIN[agent] ?? genericLogin(agent))();
}

const LOGIN: Partial<Record<AcpAgentId, () => Promise<void>>> = {
  async claude() {
    openTerminalWith("claude", ["auth", "login"], "Connexion Claude");
  },
  async openai() {
    /* `codex login` ouvre le navigateur, puis attend le retour sur son port
       local : pas besoin de terminal, on le laisse vivre en arriere-plan. */
    const { command, args } = cliLaunch("openai");
    const child = spawn(command, [...args, "login"], {
      env: subscriptionEnv(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  },
};

/** La methode de connexion a retenir parmi celles que l'agent annonce :
    un compte personnel / navigateur avant tout, jamais une cle API. */
function pickAuthMethod(methods: AuthMethod[]): AuthMethod | null {
  const score = (m: AuthMethod) => {
    const text = `${m.id} ${m.name} ${m.description ?? ""}`.toLowerCase();
    if (
      /api.?key|gateway|vertex|agent.platform|enterprise|business|device/.test(
        text,
      )
    )
      return 0;
    if (/personal|browser|oauth|log ?in|sign ?in|studio/.test(text)) return 2;
    return 1;
  };
  return (
    [...methods]
      .sort((a, b) => score(b) - score(a))
      .find((m) => score(m) > 0) ?? null
  );
}

function genericLogin(agent: AcpAgentId): () => Promise<void> {
  return async () => {
    const cwd = await scratchWorkspace();
    await prepareWorkspace(agent, cwd);
    const conn = await AcpConnection.open(agent, cwd);
    const method = pickAuthMethod(conn.authMethods);
    if (!method) {
      conn.close();
      throw new Error(
        `${acpAgentInfo(agent).label} ne propose aucune connexion par compte.`,
      );
    }
    const terminal = terminalAuthOf(method);
    if (terminal) {
      /* L'agent veut un terminal : on l'ouvre et on le laisse faire. */
      conn.close();
      const own = acpLaunch(agent);
      const command = terminal.command || own.command;
      const args = terminal.command
        ? terminal.args
        : [
            ...own.args.slice(0, own.command === process.execPath ? 1 : 0),
            ...terminal.args,
          ];
      openTerminal(
        command,
        args,
        `Connexion ${acpAgentInfo(agent).label}`,
        terminal.env,
      );
      return;
    }
    /* L'agent gere tout : il ouvre le navigateur et ne repond qu'une fois
       le compte relie. On n'attend pas ici — l'etat se relit. */
    void conn
      .authenticate(method.id)
      .catch(() => {})
      .finally(() => {
        conn.close();
        connecting.delete(agent);
        probeCache.delete(agent);
      });
  };
}

type TerminalAuth = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** Une methode « terminal », sous ses deux formes (le champ `type`
    normalise, ou la metadonnee `terminal-auth` de Zed). */
function terminalAuthOf(method: AuthMethod): TerminalAuth | null {
  const meta = (method._meta as Record<string, unknown> | null | undefined)?.[
    "terminal-auth"
  ];
  if (meta && typeof meta === "object") {
    const m = meta as {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (m.command)
      return { command: m.command, args: m.args ?? [], env: m.env ?? {} };
  }
  if ("type" in method && method.type === "terminal") {
    const m = method as {
      args?: string[] | null;
      env?: { name: string; value: string }[] | null;
    };
    /* Pas de commande : c'est l'agent lui-meme, avec ces arguments. */
    return {
      command: "",
      args: m.args ?? [],
      env: Object.fromEntries((m.env ?? []).map((e) => [e.name, e.value])),
    };
  }
  return null;
}

export async function logout(agent: AcpAgentId): Promise<void> {
  connecting.delete(agent);
  probeCache.delete(agent);
  await (LOGOUT[agent] ?? genericLogout(agent))();
}

const LOGOUT: Partial<Record<AcpAgentId, () => Promise<void>>> = {
  async claude() {
    await runCli("claude", ["auth", "logout"]);
  },
  async openai() {
    await runCli("openai", ["logout"]);
  },
  async gemini() {
    await fs.rm(path.join(os.homedir(), ".gemini", "oauth_creds.json"), {
      force: true,
    });
  },
  async copilot() {
    await runCli("copilot", ["logout"]);
  },
};

function genericLogout(agent: AcpAgentId): () => Promise<void> {
  return async () => {
    const cwd = await scratchWorkspace();
    const conn = await AcpConnection.open(agent, cwd);
    try {
      await conn.logout();
    } catch {
      /* l'agent ne sait pas se deconnecter par le protocole */
    } finally {
      conn.close();
    }
  };
}
