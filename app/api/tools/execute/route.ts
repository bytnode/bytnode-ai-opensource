import { missingKey } from "@/lib/server/openrouter";
import { PROJECT_ROOT, resolveWorkspace, workspaceError } from "@/lib/server/workspace";
import { allTools } from "@/lib/tools/registry";
import { readTransport } from "@/lib/tools/transport";
import { invalidCall } from "@/lib/tools/validate";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import type { ToolContext } from "@/lib/tools/types";
import type { AgentEvent } from "@/lib/agent/events";
import { readyRuntime } from "@/lib/plugins/host";
import { pluginSkills } from "@/lib/plugins/extras";

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
  const { openrouterKey: apiKey, bytnodeKey, exchangeAccounts, plugins } = readTransport(req.headers);
  if (!apiKey) return missingKey();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  /* `null`, a number, an array: valid JSON, but no call (`body.name` on
     `null` used to throw a bare 500). */
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!body.name || typeof body.model !== "string") {
    return Response.json({ error: { message: "Missing tool name or model." } }, { status: 400 });
  }
  const runtime = await readyRuntime();
  const { tools } = await allTools({ engine: "native", platform: process.platform, bytnodeKey, exchangeAccounts, plugins });
  const tool = tools.find((t) => t.name === body.name);
  if (!tool) return Response.json({ error: { message: `Unknown tool: ${body.name}` } }, { status: 404 });
  /* ⚠️ THE ARGUMENTS ARE CHECKED HERE TOO, not only by the agent loop: this
     route is also reached by callers that never went through it, and a tool
     trusts its schema's bounds (a Chart of 100000×100000 took the server
     down). Same sentence as the loop's, returned as a failed result. */
  const args = body.args ?? {};
  const invalid = invalidCall(tool, args);
  if (invalid) {
    const line = JSON.stringify({ type: "result", ok: false, output: invalid });
    return new Response(`${line}\n`, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
  }
  const agentId = body.agentId ?? "";
  const [profession, extra] = await Promise.all([
    loadProfession(PROJECT_ROOT, isProfessionId(body.profession) ? body.profession : DEFAULT_PROFESSION),
    pluginSkills(runtime, plugins),
  ]);

  let workspace: string;
  try {
    workspace = await resolveWorkspace(agentId, body.workspace);
  } catch (e) {
    return workspaceError(e);
  }
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
        professionSkills: [...profession.skills, ...extra],
        bytnodeKey,
        exchangeAccounts,
        plugins,
        agentId,
      };
      try {
        const result = await tool.execute(args, ctx);
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
