import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JsonSchema, Tool } from "@/lib/tools/types";
import { fail, ok, errorText } from "@/lib/tools/types";

/* ---------------------------------------------------------------------------
   BytNode, the data source OF THE AI AGENTS: a remote MCP server
   (Streamable HTTP), authenticated by the X-API-KEY header — the user's
   key, on the user's quota. The app's own code (the built-in plugins'
   views, jobs and tools, the widgets, the key check) reads BytNode's REST
   API and WebSocket instead (`lib/bytnode/`), with the app's credential
   for the plugins (`lib/bytnode/app-pass.ts`, no quota spent).

   The tools it exposes are DISCOVERED at connection (`tools/list`) and
   shown to the agents under their own names, with their descriptions — the
   server explains which data exists, not us. One session per key, kept
   open and reconnected when needed; the tool list is cached ten minutes.

   ⚠️ THIS FILE IS SERVER ONLY: the key never leaves the server except
   towards BytNode.
--------------------------------------------------------------------------- */

export const BYTNODE_MCP_URL = process.env.BYTNODE_MCP_URL ?? "https://api.bytnode.com/mcp";
const LIST_TTL = 10 * 60_000;
const CALL_TIMEOUT = 60_000;

type Session = { client: Client; tools: McpToolInfo[]; listedAt: number };

export type McpToolInfo = { name: string; description: string; inputSchema: JsonSchema };

const sessions = new Map<string, Promise<Session>>();

async function connect(apiKey: string): Promise<Session> {
  const client = new Client({ name: "agent-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(BYTNODE_MCP_URL), {
    requestInit: { headers: { "X-API-KEY": apiKey } },
  });
  await client.connect(transport);
  const tools = await listTools(client);
  return { client, tools, listedAt: Date.now() };
}

async function listTools(client: Client): Promise<McpToolInfo[]> {
  const res = await client.listTools();
  return res.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: normalizeSchema(t.inputSchema as Record<string, unknown>),
  }));
}

/* The MCP schema is JSON Schema; OpenRouter (OpenAI format) wants an
   object with `properties`. This guarantees that shape. */
function normalizeSchema(schema: Record<string, unknown> | undefined): JsonSchema {
  const s = schema ?? {};
  return {
    type: "object",
    properties: (s.properties as Record<string, unknown>) ?? {},
    ...(Array.isArray(s.required) ? { required: s.required as string[] } : {}),
  };
}

async function session(apiKey: string): Promise<Session> {
  let p = sessions.get(apiKey);
  if (!p) {
    p = connect(apiKey);
    sessions.set(apiKey, p);
    p.catch(() => sessions.delete(apiKey));
  }
  const s = await p;
  if (Date.now() - s.listedAt > LIST_TTL) {
    try {
      s.tools = await listTools(s.client);
      s.listedAt = Date.now();
    } catch {
      /* the previous list stays valid */
    }
  }
  return s;
}

/** Forgets a key's session: after a transport error, the next request
    reconnects. */
function drop(apiKey: string) {
  const p = sessions.get(apiKey);
  sessions.delete(apiKey);
  p?.then((s) => s.client.close().catch(() => {})).catch(() => {});
}

export async function bytnodeTools(apiKey: string): Promise<McpToolInfo[]> {
  if (!apiKey.trim()) return [];
  return (await session(apiKey.trim())).tools;
}

/** An MCP answer's content, as text: text blocks as they are, the others
    described. */
export function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : JSON.stringify(content);
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string; mimeType?: string; uri?: string };
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "image") return `[image ${b.mimeType ?? ""}]`;
      if (b.type === "resource") return `[resource ${b.uri ?? ""}]`;
      return JSON.stringify(block);
    })
    .join("\n");
}

/** A BytNode tool's WHOLE answer, for code that parses it (the plugins'
    prices and candles, SaveMarketData). ⚠️ Never through `ok()`: that one
    cuts at `OUTPUT_LIMIT` (40 000 characters) for the model's context, and
    300 candles already pass it — a cut JSON does not parse ("Expected
    double-quoted property name… at position 40002"). */
export async function readBytnodeTool(apiKey: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const key = apiKey.trim();
  try {
    /* Inside the try: a refused key fails at the connection, and must read
       as BytNode's refusal, not as some other source's error. */
    const s = await session(key);
    const res = await s.client.callTool({ name, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT });
    const r = res as { content?: unknown; isError?: boolean; structuredContent?: unknown };
    const text = r.content !== undefined ? contentToText(r.content) : JSON.stringify(r.structuredContent ?? r);
    return r.isError ? { ok: false, message: text || "BytNode reported an error." } : { ok: true, text };
  } catch (e) {
    const message = errorText(e);
    const status = statusOf(e);
    if (status === 401 || status === 403 || /fetch|ECONN|socket|transport|closed|401|403/i.test(message)) drop(key);
    return { ok: false, message: `BytNode (${name}) failed: ${describeBytnodeError(e)}` };
  }
}

/** A BytNode tool's answer as the model receives it: bounded. */
export async function callBytnodeTool(apiKey: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const res = await readBytnodeTool(apiKey, name, args, signal);
  return res.ok ? ok(res.text) : fail(res.message);
}

/** The BytNode tools, in the shape the registry and the loop expect. */
export function wrapBytnodeTools(apiKey: string, infos: McpToolInfo[]): Tool[] {
  return infos.map((info) => ({
    name: info.name,
    description: `[BytNode, data source] ${info.description}`.trim(),
    parameters: info.inputSchema,
    /* Market data: reading only, for every agent and every run. */
    policy: { readOnly: true, subagent: true },
    execute: (args, ctx) => callBytnodeTool(apiKey, info.name, args, ctx.signal),
  }));
}

/** The HTTP status the MCP transport attached to its error, if any. */
function statusOf(e: unknown): number | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "number" && code >= 100 && code < 600 ? code : null;
}

/* ⚠️ THE MCP TRANSPORT PUTS THE STATUS IN `code`, AND THE RAW BODY IN THE
   MESSAGE: "Streamable HTTP error: Error POSTing to endpoint:
   {"status":"error",…,"detail":"Cle API absente, invalide ou revoquee."}".
   Matching "401" in the message missed a refused key (it was reported as
   "unreachable", with the JSON and the engine's French wording on screen).
   The status decides; the body is never shown. */
const REFUSED = /cl[eé] api|api key|unauthori[sz]ed|forbidden|invalid|revoked|revoqu/i;

/** A BytNode failure in plain English, for the user and the model. */
export function describeBytnodeError(e: unknown): string {
  const status = statusOf(e);
  const message = errorText(e);
  const body = message.match(/\{[\s\S]*\}/)?.[0] ?? "";
  if (status === 401 || status === 403 || (status === null && (/\b(401|403)\b/.test(message) || REFUSED.test(body))))
    return "Key refused by BytNode: it is missing, invalid or revoked. Check it on bytnode.com.";
  if (status === 429) return "BytNode refused the request: the rate limit or your plan's quota is reached. Try again in a moment.";
  if (status !== null) return `BytNode answered with an error (HTTP ${status}). Try again in a moment.`;
  const text = message
    .replace(body, "")
    .replace(/^Streamable HTTP error:\s*/i, "")
    .replace(/Error POSTing to endpoint:?\s*/i, "")
    .trim()
    .replace(/[:\s]+$/, "");
  return text ? `BytNode is unreachable: ${text}` : "BytNode is unreachable.";
}
