import { readTransport } from "@/lib/tools/transport";
import { isAcpAgentId } from "@/lib/acp/agents";
import { cancelTurn, claimTurnAfterStop, releaseTurn, runTurn } from "@/lib/acp/sessions";
import { ndjsonOf, turnLogs } from "@/lib/acp/turn-stream";
import { syncSkills } from "@/lib/acp/skills-sync";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import { PROJECT_ROOT, resolveWorkspace, workspaceError } from "@/lib/server/workspace";
import { selfOrigin } from "@/lib/server/origin";
import { userSkills } from "@/lib/tools/skills/skill";
import { readyRuntime } from "@/lib/plugins/host";
import { pluginSkills } from "@/lib/plugins/extras";

/* ---------------------------------------------------------------------------
   One conversation turn with a subscription agent.

   NDJSON stream: `{type:"session"}` first (the id to remember), then the
   thread events (text, calls, results), the permission requests
   (`{type:"permission"}`, to be answered through /api/acp/permission), and
   `done`.

   ⚠️ CLOSING THE REQUEST NO LONGER INTERRUPTS THE TURN. The turn writes
   into its log (`turn-log.ts`), this response only reads it: a broken
   connection is read again from where it stopped through
   `/api/acp/stream` (`turnId` + `from`). Stop goes through
   `/api/acp/cancel`; a turn nobody reads for 90 s is cancelled.

   The conversation is claimed FIRST (`claimTurn`): a second prompt while
   one runs — or is still being prepared — is refused at once (409), and a
   Stop or a cancel during the preparation counts.
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
  /** Drawn by the browser: what `/api/acp/stream` asks for again. */
  turnId?: string;
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
  const agentId = body.agentId ?? "";
  const claim = await claimTurnAfterStop(body.conversationId, req.signal);
  if (!claim) return Response.json({ error: { message: "This conversation already has a turn in progress." } }, { status: 409 });
  const { bytnodeKey, exchangeAccounts, plugins } = readTransport(req.headers);
  /* ⚠️ Everything before the stream is inside a try: a throw here used to
     escape the route as a bare 500 with an empty body (an uncreatable
     workspace), and would now also keep the conversation claimed. */
  let workspace: string;
  try {
    workspace = await resolveWorkspace(agentId, body.workspace);
  } catch (e) {
    releaseTurn(claim);
    return workspaceError(e);
  }
  try {
    const runtime = await readyRuntime();
    const [profession, extra] = await Promise.all([
      loadProfession(PROJECT_ROOT, isProfessionId(body.profession) ? body.profession : DEFAULT_PROFESSION),
      pluginSkills(runtime, plugins),
    ]);
    try {
      /* The profession's skills, the plugins', then your own
         (`~/.bytnode-ai/skills/`). */
      const t0 = Date.now();
      await syncSkills(workspace, [...profession.skills, ...extra, ...(await userSkills())]);
      console.info(`[acp] skills synced in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch {
      /* a read-only folder does not prevent talking */
    }
  } catch (e) {
    releaseTurn(claim);
    return Response.json({ error: { message: `Could not prepare the turn: ${e instanceof Error ? e.message : String(e)}` } }, { status: 500 });
  }

  /* The turn runs on its own, detached from this request: its events go
     to the log, and this response is only its first reader. */
  const conversationId = body.conversationId;
  const log = turnLogs.open(conversationId, body.turnId || crypto.randomUUID(), () => cancelTurn(conversationId));
  const detached = new AbortController().signal;
  void runTurn(
    {
      conversationId,
      agent,
      agentId,
      workspace,
      origin: selfOrigin(req.url),
      bytnodeKey,
      exchangeAccounts,
      plugins,
      system: body.system ?? "",
      text: body.text,
      modelId: body.modelId ?? null,
      effort: body.effort ?? null,
      mode: body.mode ?? null,
      permissionMode: body.permissionMode === "skip" ? "skip" : "ask",
      sessionId: body.sessionId ?? null,
      firstTurn: body.firstTurn === true,
      images: Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === "string") : [],
      history: body.history,
    },
    (e) => log.push(e),
    detached,
    claim,
  )
    .catch((e: unknown) => log.push({ type: "error", message: e instanceof Error ? e.message : String(e) }))
    .finally(() => log.finish());
  return ndjsonOf(log, 0, req.signal);
}
