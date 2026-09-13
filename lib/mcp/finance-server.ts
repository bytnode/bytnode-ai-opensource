import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { saveMarketDataTool } from "@/lib/tools/finance/data";
import { chartTool } from "@/lib/tools/finance/chart";
import { backtestTool } from "@/lib/tools/finance/backtest";
import { memoryTool } from "@/lib/tools/finance/memory";
import type { Tool, ToolContext } from "@/lib/tools/types";
import { exchangeTools } from "@/lib/tools/exchange";
import { parseAccountsHeader } from "@/lib/tools/exchange/accounts";

/* ---------------------------------------------------------------------------
   Les outils financiers de BytNode-AI, servis en MCP (stdio) aux agents par
   abonnement.

   Claude Code, Codex, Gemini CLI… n'utilisent pas nos outils : ils ont les
   leurs. Mais ils parlent MCP. Ce serveur est lance par `sessions.ts` a
   cote de BytNode, avec le dossier de travail et la cle BytNode dans son
   environnement, et expose SaveMarketData, Chart, Backtest et Memory —
   la meme implementation que pour les agents OpenRouter. Un graphique
   revient en bloc image : l'agent le voit, et le fil l'affiche.

   Lance par : node node_modules/tsx/dist/cli.mjs lib/mcp/finance-server.ts
--------------------------------------------------------------------------- */

const workspace = process.env.BYTNODE_AI_WORKSPACE ?? process.cwd();
const projectRoot = process.env.BYTNODE_AI_PROJECT_ROOT ?? process.cwd();
const bytnodeKey = process.env.BYTNODE_AI_BYTNODE_KEY ?? "";
/* Les comptes exchange de l'agent, s'il en a : alors les outils exchange
   sont servis aussi. */
const exchangeAccounts = parseAccountsHeader(process.env.BYTNODE_AI_EXCHANGE_ACCOUNTS);

const TOOLS: Tool[] = [saveMarketDataTool, chartTool, backtestTool, memoryTool, ...(exchangeAccounts.length ? exchangeTools() : [])] as Tool[];

const server = new Server({ name: "bytnode-ai", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) return { content: [{ type: "text", text: `Outil inconnu : ${req.params.name}` }], isError: true };
  const ctx: ToolContext = {
    workspace,
    scope: "workspace",
    projectRoot,
    signal: extra.signal,
    emit: () => {},
    depth: 1,
    llm: { apiKey: "", model: "", effort: null },
    callId: String(extra.requestId),
    bytnodeKey,
    exchangeAccounts,
  };
  try {
    const result = await tool.execute((req.params.arguments ?? {}) as Record<string, unknown>, ctx);
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [{ type: "text", text: result.output }];
    for (const a of result.attachments ?? []) {
      if (a.type !== "image") continue;
      const m = /^data:([^;]+);base64,(.*)$/s.exec(a.dataUrl);
      if (m) content.push({ type: "image", data: m[2], mimeType: m[1] });
    }
    return { content, isError: !result.ok };
  } catch (e) {
    return { content: [{ type: "text", text: `L'outil a échoué : ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
});

void server.connect(new StdioServerTransport());
