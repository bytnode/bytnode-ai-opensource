import { readyRuntime } from "@/lib/plugins/host";
import { pluginPrompt } from "@/lib/plugins/extras";
import { readTransport } from "@/lib/tools/transport";

/* What the agent's plugins add to its prompt, re-read at every turn like
   the memory: the watchlist's symbols, the next market events… The
   plugins travel in `x-plugins`; `engine=mcp` for a subscription agent,
   which reaches the tools through the `bytnode-ai` MCP server. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const engine = url.searchParams.get("engine") === "mcp" ? "mcp" : "native";
  const { bytnodeKey, exchangeAccounts, plugins } = readTransport(req.headers);
  const runtime = await readyRuntime();
  const prompt = await pluginPrompt(runtime, plugins, { agentId, engine, subagent: false }, { "exchange-account": exchangeAccounts.length > 0, "bytnode-key": Boolean(bytnodeKey) });
  return Response.json({ prompt });
}
