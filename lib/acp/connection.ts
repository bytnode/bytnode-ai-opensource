import type { ChildProcess } from "node:child_process";
import { killTree } from "@/lib/server/process-groups";
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
import { installDone } from "./install";
import { spawnAcp } from "./launch";

/* ---------------------------------------------------------------------------
   A connection to an ACP agent: one sub-process, one JSON-RPC channel.

   The SDK does the protocol; here we hold the process, relay what the
   agent sends (`session/update`, `session/request_permission`) to whoever
   listens to the session concerned, and make sure everything dies cleanly.
--------------------------------------------------------------------------- */

export type UpdateListener = (n: SessionNotification) => void;
export type PermissionHandler = (
  req: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>;

const HANDSHAKE_TIMEOUT = 60_000;

/* ⚠️ SOME AGENTS SEND RESPONSES TO REQUESTS WE NEVER MADE. Grok Build
   pushes `{"id":"skills-reload"}` / `{"id":"workflows-reload"}` messages
   shaped like JSON-RPC responses; the SDK then reports them in the console
   every time (« Got response to unknown request »). Our own requests carry
   a NUMERIC id: so we drop responses with a string id before they reach
   the protocol. */
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

/* The agent processes alive, per agent. An update never replaces an
   agent's files while one runs: on Windows a running `claude.exe` cannot
   be overwritten, and npm would leave a half-replaced install. */
const running = new Map<AcpAgentId, number>();
export const runningProcesses = (agent: AcpAgentId) => running.get(agent) ?? 0;
const idleListeners = new Set<(agent: AcpAgentId) => void>();
/** Called when an agent's last process exits: an update waiting for it
    can run. */
export function onAgentIdle(listener: (agent: AcpAgentId) => void): void {
  idleListeners.add(listener);
}

export class AcpConnection {
  private readonly updates = new Map<string, UpdateListener>();
  private readonly permissions = new Map<string, PermissionHandler>();
  private stderr = "";
  private closed = false;
  /** Resolves once the process has exited. */
  readonly exited: Promise<void>;
  authMethods: AuthMethod[] = [];
  capabilities: AgentCapabilities = {};

  private constructor(
    readonly agent: AcpAgentId,
    private readonly child: ChildProcess,
    private readonly conn: ClientSideConnection,
  ) {
    this.exited = new Promise((resolve) => child.once("exit", () => resolve()));
    running.set(agent, runningProcesses(agent) + 1);
    let counted = true;
    const gone = () => {
      if (!counted) return;
      counted = false;
      running.set(agent, Math.max(0, runningProcesses(agent) - 1));
      if (runningProcesses(agent) === 0) for (const l of idleListeners) l(agent);
    };
    child.once("exit", gone);
    child.once("error", gone);
    child.stderr?.on("data", (b: Buffer) => {
      this.stderr = (this.stderr + b.toString("utf8")).slice(-4000);
    });
  }

  static async open(agent: AcpAgentId, cwd: string): Promise<AcpConnection> {
    /* An update in progress: wait for it rather than launch a package npm
       is replacing. */
    await installDone(agent);
    const child = spawnAcp(agent, cwd);
    if (!child.stdin || !child.stdout)
      throw new Error("Could not open the agent's channels.");
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
        reject(new Error(`Could not launch the agent: ${e.message}`)),
      );
      child.once("exit", (code) =>
        reject(
          new Error(
            `The agent stopped (code ${code}).${self?.stderr ? `\n${self.stderr.trim()}` : ""}`,
          ),
        ),
      );
    });
    const init = conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      /* `auth.terminal`: we know how to open a terminal for a sign-in. */
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        auth: { terminal: true },
      },
      clientInfo: { name: "bytnode-ai", title: "BytNode-AI", version: "0.1.0" },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("The agent is not responding.")),
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

  /** `session/close` then `session/resume`: the same session (same id, same
      history) on a fresh start of the agent's own machinery, without a new
      process. Only where the agent announces both. */
  get canRestartSession(): boolean {
    const caps = this.capabilities.sessionCapabilities;
    return Boolean(caps?.close && caps?.resume);
  }

  closeSession(sessionId: string) {
    return this.conn.closeSession({ sessionId });
  }

  resumeSession(sessionId: string, cwd: string, mcpServers: McpServer[], meta?: Record<string, unknown>) {
    return this.conn.resumeSession({ sessionId, cwd, mcpServers, ...(meta ? { _meta: meta } : {}) });
  }

  /** A turn: the text, and the attached images as content blocks (agents
      that announce `promptCapabilities.image` accept them). */
  prompt(sessionId: string, text: string, images: string[] = []): Promise<PromptResponse> {
    const blocs: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [{ type: "text", text }];
    if (this.capabilities.promptCapabilities?.image) {
      for (const dataUrl of images) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
        if (m) blocs.push({ type: "image", data: m[2], mimeType: m[1] });
      }
    }
    return this.conn.prompt({ sessionId, prompt: blocs });
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

  /** The old form of the model choice (`session/set_model`), still the
      one Gemini CLI uses. */
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
      /* already closed */
    }
    /* The agent AND what it launched (its MCP servers): on macOS / Linux
       they are in its process group, even once the agent has exited. */
    setTimeout(() => killTree(this.child, "SIGTERM", true), 1500).unref();
  }
}
