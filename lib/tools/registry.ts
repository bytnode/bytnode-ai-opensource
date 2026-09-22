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
import type { ExchangeAccount } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   The base tool set: every agent has it, in full.

   ⚠️ THIS FILE IS SERVER-ONLY (it imports fs, child_process…). The browser
   only needs the SPECIFICATIONS — name, description, schema — which it gets
   through `/api/tools`; what it shares is `TOOL_NAMES` and `GATED`, via
   `./names`.
--------------------------------------------------------------------------- */

export function baseTools(opts: { platform: string }): Tool[] {
  const { bashTool, powershellTool } = makeShellTools(opts.platform === "win32" ? "PowerShell" : "Bash");
  return [
    readTool,
    writeTool,
    editTool,
    notebookEditTool,
    globTool,
    grepTool,
    bashTool,
    powershellTool,
    monitorTool,
    makeWebSearchTool({}),
    webFetchTool,
    workflowTool,
    skillTool,
    todoTool,
    /* The finance tools: data to files, charts, standard backtest,
       memory. */
    saveMarketDataTool,
    chartTool,
    backtestTool,
    memoryTool,
  ] as Tool[];
}

/** The base tools, plus BytNode's when a key is given. Discovery can fail
    (missing key, unreachable server): the base tools alone are then
    returned, along with the reason. */
export async function allTools(opts: { platform: string; bytnodeKey?: string; exchangeAccounts?: ExchangeAccount[] }): Promise<{ tools: Tool[]; bytnode: { ok: boolean; count: number; message?: string } }> {
  /* The exchange tools only exist for an agent that has an account. */
  const base = opts.exchangeAccounts?.length ? [...baseTools(opts), ...exchangeTools()] : baseTools(opts);
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
