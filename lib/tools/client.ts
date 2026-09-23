import type { AgentEvent } from "@/lib/agent/events";
import type { ToolSpec } from "@/lib/agent/loop";
import type { ToolCall } from "@/lib/agent/tool-calls";
import type { SkillInfo } from "./skills/skill";
import type { ToolPolicy, ToolResult } from "./types";
import { transportHeaders, type Transport } from "./transport";

/* ---------------------------------------------------------------------------
   The tools, seen from the browser: their specifications on one side, their
   execution on the other — both through the server's routes, with what the
   agent's requests carry (`transport.ts`).
--------------------------------------------------------------------------- */

export type Toolset = {
  workspace: string;
  tools: ToolSpec[];
  /** Each tool's resolved policy, by name (`lib/tools/policy.ts`). */
  policies: Record<string, ToolPolicy>;
  skills: SkillInfo[];
  platform: string;
  profession: { id: string; prompt: string };
  bytnode: { ok: boolean; count: number; message?: string };
};

const cache = new Map<string, Toolset>();

export async function fetchToolset(agentId: string, workspace: string, profession: string, transport: Transport, force = false): Promise<Toolset> {
  const key = [
    agentId,
    workspace,
    profession,
    transport.bytnodeKey ? "k" : "-",
    transport.exchangeAccounts.map((a) => a.id).join(","),
    transport.plugins?.join(",") ?? "*",
  ].join("::");
  const hit = cache.get(key);
  if (hit && !force) return hit;
  const res = await fetch(
    `/api/tools?agentId=${encodeURIComponent(agentId)}&workspace=${encodeURIComponent(workspace)}&profession=${encodeURIComponent(profession)}`,
    { headers: transportHeaders({ ...transport, openrouterKey: "" }) },
  );
  if (!res.ok) throw new Error("Could not load the tools.");
  const set = (await res.json()) as Toolset;
  cache.set(key, set);
  return set;
}

export type ExecuteParams = {
  agentId: string;
  workspace: string;
  model: string;
  effort: string | null;
  scope: "workspace" | "disk";
  profession: string;
  transport: Transport;
};

/** Executes a tool on the server and relays what it reports along the way. */
export async function executeTool(call: ToolCall, p: ExecuteParams, signal: AbortSignal, emit: (e: AgentEvent) => void): Promise<ToolResult> {
  const res = await fetch("/api/tools/execute", {
    method: "POST",
    headers: { "content-type": "application/json", ...transportHeaders(p.transport) },
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
    let message = `The server answered ${res.status}.`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* non-JSON body */
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
      if (obj.type === "result") result = { ok: obj.ok, output: obj.output, attachments: obj.attachments, ...(obj.card ? { card: obj.card } : {}) };
      else emit(obj);
    }
  }
  return result ?? { ok: false, output: "The tool stopped without answering." };
}
