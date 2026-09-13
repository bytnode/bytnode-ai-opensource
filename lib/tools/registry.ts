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

/* ---------------------------------------------------------------------------
   Le jeu d'outils de base : tous les agents l'ont, en entier.

   ⚠️ CE FICHIER EST SERVEUR SEULEMENT (il importe fs, child_process…). Le
   navigateur n'a besoin que des SPECIFICATIONS — nom, description, schema —
   qu'il obtient par `/api/tools` ; c'est `TOOL_NAMES` et `GATED` qu'il
   partage, via `./names`.
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
    /* Les outils financiers : donnees en fichiers, graphiques, backtest
       standard, memoire. */
    saveMarketDataTool,
    chartTool,
    backtestTool,
    memoryTool,
  ] as Tool[];
}

/** Les outils de base, plus ceux de BytNode si une cle est donnee. La
    decouverte peut echouer (cle absente, serveur injoignable) : on rend
    alors les outils de base seuls, et la raison. */
export async function allTools(opts: { platform: string; bytnodeKey?: string }): Promise<{ tools: Tool[]; bytnode: { ok: boolean; count: number; message?: string } }> {
  const base = baseTools(opts);
  if (!opts.bytnodeKey?.trim()) return { tools: base, bytnode: { ok: false, count: 0, message: "Aucune clé BytNode." } };
  try {
    const infos = await bytnodeTools(opts.bytnodeKey);
    return { tools: [...base, ...wrapBytnodeTools(opts.bytnodeKey, infos)], bytnode: { ok: true, count: infos.length } };
  } catch (e) {
    return { tools: base, bytnode: { ok: false, count: 0, message: e instanceof Error ? e.message : String(e) } };
  }
}

export const toToolSpecs = (tools: Tool[]): ToolSpec[] =>
  tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
