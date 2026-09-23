import { readTransport } from "@/lib/tools/transport";
import { isAcpAgentId } from "@/lib/acp/agents";
import { runTurn, type WireEvent } from "@/lib/acp/sessions";
import { syncSkills } from "@/lib/acp/skills-sync";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { userSkills } from "@/lib/tools/skills/skill";

/* ---------------------------------------------------------------------------
   One conversation turn with a subscription agent.

   NDJSON stream: `{type:"session"}` first (the id to remember), then the
   thread events (text, calls, results), the permission requests
   (`{type:"permission"}`, to be answered through /api/acp/permission), and
   `done`. Closing the request interrupts the turn.
--------------------------------------------------------------------------- */

type Body = {
  conversationId?: string;
  agent?: string;
  agentId?: string;
  workspace?: string;
  profession?: string;
  system?: string;
  text?: string;
  modelId?: string | null;
  effort?: string | null;
  mode?: string | null;
  permissionMode?: "ask" | "skip";
  sessionId?: string | null;
  firstTurn?: boolean;
  images?: string[];
  history?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!body.conversationId || !isAcpAgentId(body.agent) || typeof body.text !== "string") {
    return Response.json({ error: { message: "Missing conversation, agent or message." } }, { status: 400 });
  }
  const agent = body.agent;
  const { bytnodeKey, exchangeAccounts } = readTransport(req.headers);
  const workspace = await resolveWorkspace(body.agentId ?? "", body.workspace);
  const profession = await loadProfession(PROJECT_ROOT, isProfessionId(body.profession) ? body.profession : DEFAULT_PROFESSION);
  try {
    /* The profession's skills, then your own (`~/.bytnode-ai/skills/`). */
    const t0 = Date.now();
    await syncSkills(workspace, [...profession.skills, ...(await userSkills())]);
    console.info(`[acp] skills synced in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch {
    /* a read-only folder does not prevent talking */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: WireEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };
      try {
        await runTurn(
          {
            conversationId: body.conversationId!,
            agent,
            workspace,
            origin: new URL(req.url).origin,
            bytnodeKey,
            exchangeAccounts,
            system: body.system ?? "",
            text: body.text!,
            modelId: body.modelId ?? null,
            effort: body.effort ?? null,
            mode: body.mode ?? null,
            permissionMode: body.permissionMode === "skip" ? "skip" : "ask",
            sessionId: body.sessionId ?? null,
            firstTurn: body.firstTurn === true,
            images: Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === "string") : [],
            history: body.history,
          },
          send,
          req.signal,
        );
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
