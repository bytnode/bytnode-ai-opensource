import { missingKey } from "@/lib/server/openrouter";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { allTools } from "@/lib/tools/registry";
import { readTransport } from "@/lib/tools/transport";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import type { ToolContext } from "@/lib/tools/types";
import type { AgentEvent } from "@/lib/agent/events";

/* ---------------------------------------------------------------------------
   Execute a tool, and tell what happens along the way.

   The response is an NDJSON stream: the events emitted during execution
   (the lines of a Monitor, the state of the sub-agents), then a final
   `{ type: "result", ... }` object. Closing the request interrupts the tool.
--------------------------------------------------------------------------- */

type Body = {
  name?: string;
  args?: Record<string, unknown>;
  agentId?: string;
  workspace?: string;
  model?: string;
  effort?: string | null;
  callId?: string;
  scope?: "workspace" | "disk";
  profession?: string;
};

export async function POST(req: Request) {
  const { openrouterKey: apiKey, bytnodeKey, exchangeAccounts } = readTransport(req.headers);
  if (!apiKey) return missingKey();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!body.name || typeof body.model !== "string") {
    return Response.json({ error: { message: "Missing tool name or model." } }, { status: 400 });
  }
  const { tools } = await allTools({ engine: "native", platform: process.platform, bytnodeKey, exchangeAccounts });
  const tool = tools.find((t) => t.name === body.name);
  if (!tool) return Response.json({ error: { message: `Unknown tool: ${body.name}` } }, { status: 404 });
  const profession = await loadProfession(PROJECT_ROOT, isProfessionId(body.profession) ? body.profession : DEFAULT_PROFESSION);

  const workspace = await resolveWorkspace(body.agentId ?? "", body.workspace);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };
      const ctx: ToolContext = {
        workspace,
        scope: body.scope === "disk" ? "disk" : "workspace",
        projectRoot: PROJECT_ROOT,
        signal: req.signal,
        emit: (e: AgentEvent) => send(e),
        depth: 0,
        llm: { apiKey, model: body.model as string, effort: body.effort ?? null },
        callId: body.callId ?? "call",
        professionSkills: profession.skills,
        bytnodeKey,
        exchangeAccounts,
      };
      try {
        const result = await tool.execute(body.args ?? {}, ctx);
        send({ type: "result", ...result });
      } catch (e) {
        send({ type: "result", ok: false, output: `The tool failed: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
