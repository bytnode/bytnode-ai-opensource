import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JsonSchema, Tool } from "@/lib/tools/types";
import { fail, ok, errorText } from "@/lib/tools/types";

/* ---------------------------------------------------------------------------
   BytNode, la source de donnees : un serveur MCP distant (Streamable HTTP),
   authentifie par l'en-tete X-API-KEY.

   Les outils qu'il expose sont DECOUVERTS a la connexion (`tools/list`) et
   presentes aux agents sous leurs propres noms, avec leurs descriptions —
   c'est le serveur qui explique quelles donnees existent, pas nous. Une
   session par cle, gardee ouverte et reconnectee au besoin ; la liste des
   outils est mise en cache dix minutes.

   ⚠️ CE FICHIER EST SERVEUR SEULEMENT : la cle ne quitte jamais le serveur
   autrement que vers BytNode.
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

/* Le schema MCP est du JSON Schema ; OpenRouter (format OpenAI) veut un
   objet avec `properties`. On garantit cette forme. */
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
      /* la liste precedente reste valable */
    }
  }
  return s;
}

/** Oublie la session d'une cle : apres une erreur de transport, la
    prochaine demande reconnecte. */
function drop(apiKey: string) {
  const p = sessions.get(apiKey);
  sessions.delete(apiKey);
  p?.then((s) => s.client.close().catch(() => {})).catch(() => {});
}

export async function bytnodeTools(apiKey: string): Promise<McpToolInfo[]> {
  if (!apiKey.trim()) return [];
  return (await session(apiKey.trim())).tools;
}

/** Le contenu d'une reponse MCP, en texte : les blocs texte tels quels, les
    autres decrits. */
export function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : JSON.stringify(content);
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string; mimeType?: string; uri?: string };
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "image") return `[image ${b.mimeType ?? ""}]`;
      if (b.type === "resource") return `[ressource ${b.uri ?? ""}]`;
      return JSON.stringify(block);
    })
    .join("\n");
}

export async function callBytnodeTool(apiKey: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const key = apiKey.trim();
  const s = await session(key);
  try {
    const res = await s.client.callTool({ name, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT });
    const r = res as { content?: unknown; isError?: boolean; structuredContent?: unknown };
    const text = r.content !== undefined ? contentToText(r.content) : JSON.stringify(r.structuredContent ?? r);
    return r.isError ? fail(text || "BytNode a signalé une erreur.") : ok(text);
  } catch (e) {
    const message = errorText(e);
    if (/fetch|ECONN|socket|transport|closed|401|403/i.test(message)) drop(key);
    return fail(`BytNode (${name}) a échoué : ${message}`);
  }
}

/** Les outils BytNode, sous la forme que le registre et la boucle attendent. */
export function wrapBytnodeTools(apiKey: string, infos: McpToolInfo[]): Tool[] {
  return infos.map((info) => ({
    name: info.name,
    description: `[BytNode, source de données] ${info.description}`.trim(),
    parameters: info.inputSchema,
    execute: (args, ctx) => callBytnodeTool(apiKey, info.name, args, ctx.signal),
  }));
}

/** Verifie une cle : la connexion aboutit et la liste des outils arrive. */
export async function checkBytnodeKey(apiKey: string): Promise<{ ok: true; tools: string[] } | { ok: false; message: string }> {
  try {
    const tools = await bytnodeTools(apiKey);
    return { ok: true, tools: tools.map((t) => t.name) };
  } catch (e) {
    drop(apiKey.trim());
    const message = errorText(e);
    return { ok: false, message: /401|403|unauthorized/i.test(message) ? "Clé refusée par BytNode." : `BytNode injoignable : ${message}` };
  }
}
