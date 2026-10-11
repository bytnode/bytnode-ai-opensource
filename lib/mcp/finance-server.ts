import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Tool, ToolContext } from "@/lib/tools/types";
import { allTools } from "@/lib/tools/registry";
import { parseAccountsHeader } from "@/lib/tools/exchange/accounts";
import { parsePluginIds } from "@/lib/tools/transport";
import { startToolsRuntime } from "@/lib/plugins/host";
import type { PluginsState } from "@/lib/domain/plugins";
import { acpWorkflowTool, agentModels, announceReady, confirmThroughApp, parentLinkFromEnv, readyLinkFromEnv } from "./acp-workflow";
import { serveCall } from "./serve-call";

/* ---------------------------------------------------------------------------
   BytNode-AI's own tools, served over MCP (stdio) to subscription agents.

   Claude Code, Codex, Grok Build… do not use our tools: they have their
   own. But they speak MCP. This server is launched by `sessions.ts` next to
   BytNode, with the workspace and the keys in its environment, and serves
   the tools of the MCP engine of the registry (`lib/tools/registry.ts`) —
   the same implementation as for OpenRouter agents — plus Workflow, the
   sub-agents by profession, which go back through the Next server. A chart
   comes back as an image block: the agent sees it, and the thread shows it.

   The depth (`BYTNODE_AI_DEPTH`) says whom we serve: a main agent (0) gets
   everything; a sub-agent (1) only what its policy allows it — neither
   Workflow nor any tool that commits funds: it has nobody to ask. And a
   tool that commits funds never runs before BytNode-AI's user has
   confirmed it (`serveCall` → `/api/acp/confirm`), whatever the agent's
   own permission mode.

   Launched by `sessions.ts` through `server-launch.ts`: from the bundle
   prepack builds (`.next/finance-server.mjs`) in an installed package,
   through tsx on this file in development.
--------------------------------------------------------------------------- */

const workspace = process.env.BYTNODE_AI_WORKSPACE ?? process.cwd();
const projectRoot = process.env.BYTNODE_AI_PROJECT_ROOT ?? process.cwd();
const bytnodeKey = process.env.BYTNODE_AI_BYTNODE_KEY ?? "";
const depth = process.env.BYTNODE_AI_DEPTH === "1" ? 1 : 0;
/* The agent's exchange accounts, if it has any: then the exchange tools
   are served too. */
const exchangeAccounts = parseAccountsHeader(process.env.BYTNODE_AI_EXCHANGE_ACCOUNTS);
const parent = depth === 0 ? parentLinkFromEnv(process.env) : null;
const agentId = process.env.BYTNODE_AI_AGENT_ID ?? "";
/* The plugins enabled for the agent (empty variable: every running one),
   and the state to start them with — the same as the Next server's. */
const plugins = process.env.BYTNODE_AI_PLUGINS ? parsePluginIds(safeJson(process.env.BYTNODE_AI_PLUGINS)) : null;
const pluginState = (safeJson(process.env.BYTNODE_AI_PLUGIN_STATE ?? "") ?? {}) as PluginsState;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* The list of the agent's models is read at the first `tools/list` (the
   Next server has it cached); the tool set is built once. */
let tools: Promise<Tool[]> | null = null;
const toolset = () =>
  (tools ??= (async () => {
    await startToolsRuntime(pluginState, { bytnodeKey, accounts: exchangeAccounts });
    const { tools: own } = await allTools({ engine: "mcp", platform: process.platform, bytnodeKey, exchangeAccounts, depth, plugins });
    if (!parent) return own;
    return [...own, acpWorkflowTool(parent, await agentModels(parent), { openrouterKey: "", bytnodeKey, exchangeAccounts, plugins }) as Tool];
  })());

const server = new Server({ name: "bytnode-ai", version: "0.1.0" }, { capabilities: { tools: {} } });

/* The session that launched us may be waiting for our tools before its
   first prompt (Codex does not wait for its MCP servers): once the list
   has gone out, we say so. */
const ready = readyLinkFromEnv(process.env);
let announced = false;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const listed = { tools: (await toolset()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) };
  if (ready && !announced) {
    announced = true;
    setTimeout(() => void announceReady(ready), 0);
  }
  return listed;
});

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const tool = (await toolset()).find((t) => t.name === req.params.name);
  if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const ctx: ToolContext = {
    workspace,
    scope: "workspace",
    projectRoot,
    signal: extra.signal,
    emit: () => {},
    depth,
    llm: { apiKey: "", model: "", effort: null },
    callId: String(extra.requestId),
    bytnodeKey,
    exchangeAccounts,
    plugins,
    agentId,
  };
  /* A money action waits for the user's yes in BytNode-AI (`serveCall`):
     only a main agent's server can ask — a sub-agent's has no parent link,
     and refuses. */
  return serveCall(tool, args, ctx, parent ? (name, a, signal) => confirmThroughApp(parent, name, a, signal) : null);
});

void server.connect(new StdioServerTransport());
