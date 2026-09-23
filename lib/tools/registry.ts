import type { Tool } from "./types";
import type { ToolSpec } from "@/lib/agent/loop";
import { readTool } from "./fs/read";
import { writeTool } from "./fs/write";
import { editTool } from "./fs/edit";
import { notebookEditTool } from "./fs/notebook-edit";
import { globTool } from "./fs/glob";
import { grepTool } from "./fs/grep";
import { makeShellTools } from "./exec/shells";
import { monitorTool } from "./exec/monitor";
import { makeWebSearchTool } from "./web/search";
import { bytnodeTools, wrapBytnodeTools } from "@/lib/mcp/bytnode";
import { webFetchTool } from "./web/fetch";
import { skillTool } from "./skills/skill";
import { todoTool } from "./todo";
import { workflowTool } from "./agents/workflow";
import { saveMarketDataTool } from "./finance/data";
import { chartTool } from "./finance/chart";
import { backtestTool } from "./finance/backtest";
import { memoryTool } from "./finance/memory";
import { exchangeTools } from "./exchange";
import { resolvePolicy } from "./policy";
import { openViewTool } from "./views/open-view";
import type { ExchangeAccount } from "@/lib/domain/types";
import { activeRuntime } from "@/lib/plugins/core/active";

/* ---------------------------------------------------------------------------
   The tool registry: ONE list, for both engines.

   - The native engine (agents on an OpenRouter key: the browser's loop,
     Workflow sub-agents) gets the general tools — files, shells, web,
     skills, plan, Workflow — plus BytNode-AI's own tools, plus the BytNode
     data tools discovered live.
   - The MCP engine (`lib/mcp/finance-server.ts`, for subscription agents)
     gets BytNode-AI's own tools only: the external agent has its own
     general tools, and BytNode is given to it as a separate MCP server.
   - Both get the tools of the plugins enabled for the agent (whose needs it
     meets: an exchange account, a BytNode key) and, for a main agent,
     OpenView to open their views.
   - A sub-agent or a background run (`depth` ≥ 1) keeps only the tools
     whose policy allows it (`policy.ts`).

   ⚠️ THIS FILE IS SERVER-ONLY (it imports fs, child_process…). The browser
   only needs the SPECIFICATIONS and the POLICIES, which it gets through
   `/api/tools`.
--------------------------------------------------------------------------- */

export type ToolsetOptions = {
  engine: "native" | "mcp";
  platform: string;
  bytnodeKey?: string;
  /** The exchange accounts the agent may drive: no account, no exchange
      tool. */
  exchangeAccounts?: ExchangeAccount[];
  /** 0: the main agent. 1: a sub-agent or a background run. */
  depth?: number;
  /** The plugins enabled for the agent; `null` or absent: every running one. */
  plugins?: string[] | null;
};

export type BytnodeStatus = { ok: boolean; count: number; message?: string };

/** The general tools: what an external agent already has on its own. */
export function generalTools(platform: string): Tool[] {
  const { bashTool, powershellTool } = makeShellTools(platform === "win32" ? "PowerShell" : "Bash");
  return [readTool, writeTool, editTool, notebookEditTool, globTool, grepTool, bashTool, powershellTool, monitorTool, makeWebSearchTool({}), webFetchTool, workflowTool, skillTool, todoTool] as Tool[];
}

/** BytNode-AI's own core tools, served to both engines: the finance tools
    (data to files, charts, standard backtest, memory) and, for an agent
    with an account, the exchange tools. */
export function bytnodeAiTools(opts: Pick<ToolsetOptions, "exchangeAccounts">): Tool[] {
  const finance = [saveMarketDataTool, chartTool, backtestTool, memoryTool] as Tool[];
  return opts.exchangeAccounts?.length ? [...finance, ...exchangeTools()] : finance;
}

/** The tools of the plugins enabled for the agent, and OpenView for their
    views (main agent only: its policy keeps it from sub-agents anyway). */
function pluginTools(opts: ToolsetOptions): Tool[] {
  const runtime = activeRuntime();
  if (!runtime) return [];
  const ids = opts.plugins ?? null;
  const tools = runtime.tools(ids, { "exchange-account": (opts.exchangeAccounts?.length ?? 0) > 0, "bytnode-key": Boolean(opts.bytnodeKey?.trim()) });
  const views = runtime.views(ids);
  return views.length ? [...tools, openViewTool(views) as Tool] : tools;
}

const forDepth = (tools: Tool[], depth: number | undefined) => ((depth ?? 0) >= 1 ? tools.filter((t) => resolvePolicy(t.name, t.policy).subagent) : tools);

/** The tools of an engine. The native engine also gets BytNode's when a key
    is given; discovery can fail (missing key, unreachable server): the
    other tools are then returned, along with the reason. */
export async function allTools(opts: ToolsetOptions): Promise<{ tools: Tool[]; bytnode: BytnodeStatus }> {
  const own = [...bytnodeAiTools(opts), ...pluginTools(opts)];
  if (opts.engine === "mcp") return { tools: forDepth(own, opts.depth), bytnode: { ok: false, count: 0, message: "Served as its own MCP server." } };
  const base = forDepth([...generalTools(opts.platform), ...own], opts.depth);
  if (!opts.bytnodeKey?.trim()) return { tools: base, bytnode: { ok: false, count: 0, message: "No BytNode key." } };
  try {
    const infos = await bytnodeTools(opts.bytnodeKey);
    return { tools: [...base, ...wrapBytnodeTools(opts.bytnodeKey, infos)], bytnode: { ok: true, count: infos.length } };
  } catch (e) {
    return { tools: base, bytnode: { ok: false, count: 0, message: e instanceof Error ? e.message : String(e) } };
  }
}

export const toToolSpecs = (tools: Tool[]): ToolSpec[] =>
  tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
