import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Tool, ToolContext } from "@/lib/tools/types";
import { allTools } from "@/lib/tools/registry";
import { parseAccountsHeader } from "@/lib/tools/exchange/accounts";
import { validateArgs } from "@/lib/tools/validate";
import { parsePluginIds } from "@/lib/tools/transport";
import { startToolsRuntime } from "@/lib/plugins/host";
import type { PluginsState } from "@/lib/domain/plugins";
import { CARD_URI } from "@/lib/acp/wire";
import { acpWorkflowTool, agentModels, parentLinkFromEnv } from "./acp-workflow";

/* ---------------------------------------------------------------------------
   BytNode-AI's own tools, served over MCP (stdio) to subscription agents.

   Claude Code, Codex, Gemini CLI… do not use our tools: they have their
   own. But they speak MCP. This server is launched by `sessions.ts` next to
   BytNode, with the workspace and the keys in its environment, and serves
   the tools of the MCP engine of the registry (`lib/tools/registry.ts`) —
   the same implementation as for OpenRouter agents — plus Workflow, the
   sub-agents by profession, which go back through the Next server. A chart
   comes back as an image block: the agent sees it, and the thread shows it.

   The depth (`BYTNODE_AI_DEPTH`) says whom we serve: a main agent (0) gets
   everything; a sub-agent (1) only what its policy allows it — neither
   Workflow nor any tool that commits funds: it has nobody to ask.

   Launched by: node node_modules/tsx/dist/cli.mjs lib/mcp/finance-server.ts
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
    await startToolsRuntime(pluginState);
    const { tools: own } = await allTools({ engine: "mcp", platform: process.platform, bytnodeKey, exchangeAccounts, depth, plugins });
    if (!parent) return own;
    return [...own, acpWorkflowTool(parent, await agentModels(parent), { openrouterKey: "", bytnodeKey, exchangeAccounts, plugins }) as Tool];
  })());

const server = new Server({ name: "bytnode-ai", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: (await toolset()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const tool = (await toolset()).find((t) => t.name === req.params.name);
  if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  /* Like the OpenRouter loop: an ill-formed call goes back to the model in
     one sentence, without running. */
  const invalid = validateArgs(tool.parameters, args);
  if (invalid) return { content: [{ type: "text", text: `Invalid arguments for ${tool.name}: ${invalid} Fix the call.` }], isError: true };
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
  try {
    const result = await tool.execute(args, ctx);
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "resource"; resource: { uri: string; mimeType: string; text: string } }> = [
      { type: "text", text: result.output },
    ];
    for (const a of result.attachments ?? []) {
      if (a.type !== "image") continue;
      const m = /^data:([^;]+);base64,(.*)$/s.exec(a.dataUrl);
      if (m) content.push({ type: "image", data: m[2], mimeType: m[1] });
    }
    /* The plugin's card for the thread, as a resource the translation
       picks up (`lib/acp/translate.ts`, `cardOf`). */
    if (result.card) content.push({ type: "resource", resource: { uri: CARD_URI, mimeType: "application/json", text: JSON.stringify(result.card) } });
    return { content, isError: !result.ok };
  } catch (e) {
    return { content: [{ type: "text", text: `The tool failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
});

void server.connect(new StdioServerTransport());
