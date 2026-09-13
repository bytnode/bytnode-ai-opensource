import type { AgentEvent } from "@/lib/agent/events";
import type { ToolSpec } from "@/lib/agent/loop";
import type { ToolCall } from "@/lib/agent/tool-calls";
import type { SkillInfo } from "./skills/skill";
import type { ToolResult } from "./types";
import type { ExchangeAccount } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   Les outils, vus du navigateur : leurs specifications d'un cote, leur
   execution de l'autre — les deux par les routes du serveur.
--------------------------------------------------------------------------- */

export type Toolset = {
  workspace: string;
  tools: ToolSpec[];
  skills: SkillInfo[];
  platform: string;
  profession: { id: string; prompt: string };
  bytnode: { ok: boolean; count: number; message?: string };
};

const cache = new Map<string, Toolset>();

export async function fetchToolset(
  agentId: string,
  workspace: string,
  profession: string,
  bytnodeKey: string,
  exchangeAccounts: ExchangeAccount[] = [],
  force = false,
): Promise<Toolset> {
  const key = `${agentId}::${workspace}::${profession}::${bytnodeKey ? "k" : "-"}::${exchangeAccounts.map((a) => a.id).join(",")}`;
  const hit = cache.get(key);
  if (hit && !force) return hit;
  const res = await fetch(
    `/api/tools?agentId=${encodeURIComponent(agentId)}&workspace=${encodeURIComponent(workspace)}&profession=${encodeURIComponent(profession)}`,
    { headers: { ...(bytnodeKey ? { "x-bytnode-key": bytnodeKey } : {}), ...exchangeHeader(exchangeAccounts) } },
  );
  if (!res.ok) throw new Error("Impossible de charger les outils.");
  const set = (await res.json()) as Toolset;
  cache.set(key, set);
  return set;
}

export type ExecuteParams = {
  apiKey: string;
  agentId: string;
  workspace: string;
  model: string;
  effort: string | null;
  scope: "workspace" | "disk";
  profession: string;
  bytnodeKey: string;
  exchangeAccounts: ExchangeAccount[];
};

/** Les comptes exchange de l'agent, en en-tete — rien si aucun. */
const exchangeHeader = (accounts: ExchangeAccount[]): Record<string, string> =>
  accounts.length ? { "x-exchange-accounts": JSON.stringify(accounts) } : {};

/** Execute un outil sur le serveur et relaie ce qu'il raconte en chemin. */
export async function executeTool(call: ToolCall, p: ExecuteParams, signal: AbortSignal, emit: (e: AgentEvent) => void): Promise<ToolResult> {
  const res = await fetch("/api/tools/execute", {
    method: "POST",
    headers: { "content-type": "application/json", "x-openrouter-key": p.apiKey, ...(p.bytnodeKey ? { "x-bytnode-key": p.bytnodeKey } : {}), ...exchangeHeader(p.exchangeAccounts) },
    body: JSON.stringify({
      name: call.name,
      args: call.args,
      callId: call.id,
      agentId: p.agentId,
      workspace: p.workspace,
      model: p.model,
      effort: p.effort,
      scope: p.scope,
      profession: p.profession,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Le serveur a répondu ${res.status}.`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* corps non JSON */
    }
    return { ok: false, output: message };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  let result: ToolResult | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: (AgentEvent | (ToolResult & { type: "result" })) | null = null;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!obj) continue;
      if (obj.type === "result") result = { ok: obj.ok, output: obj.output, attachments: obj.attachments };
      else emit(obj);
    }
  }
  return result ?? { ok: false, output: "L'outil s'est arrêté sans répondre." };
}
