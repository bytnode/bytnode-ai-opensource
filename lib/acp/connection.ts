import { spawnSync, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type AuthMethod,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type AnyMessage,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import type { AcpAgentId } from "./agents";
import { spawnAcp } from "./launch";

/* ---------------------------------------------------------------------------
   Une connexion a un agent ACP : un sous-processus, un canal JSON-RPC.

   Le SDK fait le protocole ; ici on tient le processus, on relaie ce que
   l'agent envoie (`session/update`, `session/request_permission`) a qui
   ecoute la session concernee, et on s'assure que tout meurt proprement.
--------------------------------------------------------------------------- */

export type UpdateListener = (n: SessionNotification) => void;
export type PermissionHandler = (
  req: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>;

const HANDSHAKE_TIMEOUT = 60_000;

/* ⚠️ CERTAINS AGENTS ENVOIENT DES REPONSES A DES REQUETES QU'ON N'A PAS
   FAITES. Grok Build pousse des messages `{"id":"skills-reload"}` /
   `{"id":"workflows-reload"}` en forme de reponse JSON-RPC ; le SDK les
   signale alors dans la console a chaque fois (« Got response to unknown
   request »). Nos requetes, elles, portent un id NUMERIQUE : on jette donc
   les reponses a id textuel avant qu'elles n'atteignent le protocole. */
const isStrayResponse = (m: unknown): boolean => {
  if (typeof m !== "object" || m === null) return false;
  const msg = m as { id?: unknown; method?: unknown };
  return msg.method === undefined && typeof msg.id === "string";
};

function withoutStrayResponses(stream: Stream): Stream {
  return {
    writable: stream.writable,
    readable: stream.readable.pipeThrough(
      new TransformStream<AnyMessage, AnyMessage>({
        transform(message, controller) {
          if (!isStrayResponse(message)) controller.enqueue(message);
        },
      }),
    ),
  };
}

export class AcpConnection {
  private readonly updates = new Map<string, UpdateListener>();
  private readonly permissions = new Map<string, PermissionHandler>();
  private stderr = "";
  private closed = false;
  /** Se resout quand le processus est sorti. */
  readonly exited: Promise<void>;
  authMethods: AuthMethod[] = [];
  capabilities: AgentCapabilities = {};

  private constructor(
    readonly agent: AcpAgentId,
    private readonly child: ChildProcess,
    private readonly conn: ClientSideConnection,
  ) {
    this.exited = new Promise((resolve) => child.once("exit", () => resolve()));
    child.stderr?.on("data", (b: Buffer) => {
      this.stderr = (this.stderr + b.toString("utf8")).slice(-4000);
    });
  }

  static async open(agent: AcpAgentId, cwd: string): Promise<AcpConnection> {
    const child = spawnAcp(agent, cwd);
    if (!child.stdin || !child.stdout)
      throw new Error("Impossible d'ouvrir les canaux de l'agent.");
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    let self: AcpConnection | null = null;
    const conn = new ClientSideConnection(
      () => ({
        requestPermission: (params) => {
          const h = self?.permissions.get(params.sessionId);
          if (!h) return { outcome: { outcome: "cancelled" } };
          return h(params);
        },
        sessionUpdate: (params) => {
          self?.updates.get(params.sessionId)?.(params);
        },
      }),
      withoutStrayResponses(stream),
    );
    self = new AcpConnection(agent, child, conn);
    const spawnError = new Promise<never>((_, reject) => {
      child.once("error", (e) =>
        reject(new Error(`Lancement de l'agent impossible : ${e.message}`)),
      );
      child.once("exit", (code) =>
        reject(
          new Error(
            `L'agent s'est arrêté (code ${code}).${self?.stderr ? `\n${self.stderr.trim()}` : ""}`,
          ),
        ),
      );
    });
    const init = conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      /* `auth.terminal` : on sait ouvrir un terminal pour une connexion. */
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        auth: { terminal: true },
      },
      clientInfo: { name: "bytnode-ai", title: "BytNode-AI", version: "0.1.0" },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("L'agent ne répond pas.")),
        HANDSHAKE_TIMEOUT,
      ).unref(),
    );
    try {
      const res = await Promise.race([init, spawnError, timeout]);
      self.authMethods = res.authMethods ?? [];
      self.capabilities = res.agentCapabilities ?? {};
    } catch (e) {
      self.close();
      throw e;
    }
    return self;
  }

  get alive() {
    return !this.closed && this.child.exitCode === null && !this.child.killed;
  }

  get lastStderr() {
    return this.stderr.trim();
  }

  authenticate(methodId: string) {
    return this.conn.authenticate({ methodId });
  }

  logout() {
    return this.conn.logout({});
  }

  newSession(
    cwd: string,
    mcpServers: McpServer[],
    meta?: Record<string, unknown>,
  ): Promise<NewSessionResponse> {
    return this.conn.newSession({
      cwd,
      mcpServers,
      ...(meta ? { _meta: meta } : {}),
    });
  }

  loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[],
    meta?: Record<string, unknown>,
  ): Promise<LoadSessionResponse> {
    return this.conn.loadSession({
      sessionId,
      cwd,
      mcpServers,
      ...(meta ? { _meta: meta } : {}),
    });
  }

  prompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.conn.prompt({ sessionId, prompt: [{ type: "text", text }] });
  }

  cancel(sessionId: string) {
    return this.conn.cancel({ sessionId });
  }

  setConfig(sessionId: string, configId: string, value: string) {
    return this.conn.setSessionConfigOption({ sessionId, configId, value });
  }

  setMode(sessionId: string, modeId: string) {
    return this.conn.setSessionMode({ sessionId, modeId });
  }

  /** L'ancienne forme du choix de modele (`session/set_model`), encore
      celle de Gemini CLI. */
  setModel(sessionId: string, modelId: string) {
    return this.conn.request<unknown, { sessionId: string; modelId: string }>(
      "session/set_model",
      { sessionId, modelId },
    );
  }

  listen(
    sessionId: string,
    onUpdate: UpdateListener | null,
    onPermission: PermissionHandler | null,
  ) {
    if (onUpdate) this.updates.set(sessionId, onUpdate);
    else this.updates.delete(sessionId);
    if (onPermission) this.permissions.set(sessionId, onPermission);
    else this.permissions.delete(sessionId);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.updates.clear();
    this.permissions.clear();
    try {
      this.child.stdin?.end();
    } catch {
      /* deja ferme */
    }
    const kill = () => {
      if (this.child.exitCode !== null) return;
      if (process.platform === "win32" && this.child.pid) {
        try {
          spawnSync("taskkill", ["/pid", String(this.child.pid), "/t", "/f"], {
            windowsHide: true,
          });
          return;
        } catch {
          /* on retombe sur kill */
        }
      }
      this.child.kill();
    };
    setTimeout(kill, 1500).unref();
  }
}
