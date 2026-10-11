import { buildSystemPrompt } from "@/lib/agent/prompt";
import { buildToolsPrompt } from "@/lib/agent/tools-prompt";
import { runAgentLoop } from "@/lib/agent/loop";
import { acpAgentOf, acpModelId } from "@/lib/acp/agents";
import { buildAcpPrompt } from "@/lib/acp/prompt";
import { bytnodeStatus, runBackground } from "@/lib/acp/sessions";
import { loadProfession } from "@/lib/professions/load";
import { streamOpenRouter } from "@/lib/server/openrouter-stream";
import { OPENROUTER } from "@/lib/server/openrouter";
import { latestModels, parseOpenRouterModels } from "@/lib/catalog/catalog";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { allowedAccounts } from "@/lib/tools/exchange/accounts";
import { allTools, toToolSpecs } from "@/lib/tools/registry";
import { listSkills } from "@/lib/tools/skills/skill";
import type { ToolContext } from "@/lib/tools/types";
import type { Session } from "../core/contract";
import { activeRuntime } from "../core/active";
import { pluginsForAgent } from "../core/state";
import { PLUGIN_MANIFESTS } from "../catalog";
import { pluginPrompt, pluginSkills } from "../extras";
import type { AgentRunInput, AgentRunResult } from "./service";
import { backgroundFrame, findAgent } from "./tasks";

/* ---------------------------------------------------------------------------
   An agent of the user's, run in the background — by key or by
   subscription, the same way.

   It gets what a sub-agent gets: its profession, its skills, its plugins,
   its exchange accounts READ-ONLY — the registry at depth 1 keeps only the
   tools whose policy allows a run nobody watches (no order, no transfer,
   no Workflow, no OpenView) — and a frame that says so. Its final text is
   the result. SERVER-ONLY.
--------------------------------------------------------------------------- */

const TURNS = 25;

/** Never throws: whatever breaks — the workspace folder refused, a
    profession unreadable, the model — comes back as `{ ok: false, error }`,
    which the scheduler records and announces. (A throw before the run
    used to go unrecorded, and the task was launched again every 15 s.) */
export async function runAgentInBackground(input: AgentRunInput, session: Session): Promise<AgentRunResult> {
  try {
    return await run(input, session);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function run(input: AgentRunInput, session: Session): Promise<AgentRunResult> {
  const agent = findAgent(session.agents, input.agentId);
  if (!agent) return { ok: false, error: `No agent "${input.agentId}" in the settings.` };
  const runtime = activeRuntime();
  /* The runtime's manifests: the plugins written by agents are among them. */
  const plugins = pluginsForAgent(runtime?.manifests ?? PLUGIN_MANIFESTS, session.plugins, agent.id);
  const accounts = allowedAccounts(session.exchangeAccounts, agent.exchangeAccountIds);
  const workspace = await resolveWorkspace(agent.id, agent.workspace);
  const needs = { "exchange-account": accounts.length > 0, "bytnode-key": Boolean(session.bytnodeKey.trim()) };
  const [prof, extraSkills, plugged] = await Promise.all([
    loadProfession(PROJECT_ROOT, agent.profession),
    runtime ? pluginSkills(runtime, plugins) : [],
    runtime ? pluginPrompt(runtime, plugins, { agentId: agent.id, engine: acpAgentOf(agent.providerId) ? "mcp" : "native", subagent: true }, needs) : "",
  ]);
  const skills = await listSkills(workspace, [...prof.skills, ...extraSkills]);
  const frame = backgroundFrame(input.purpose, new Date());
  const acp = acpAgentOf(agent.providerId);

  try {
    if (acp) {
      const system = [buildSystemPrompt(session.profile, agent), prof.prompt, buildAcpPrompt(workspace, skills, await bytnodeStatus(session.bytnodeKey), acp.product, accounts, 0, true), plugged, frame].filter(Boolean).join("\n\n");
      const text = await runBackground(
        {
          agent: acp.id,
          agentId: agent.id,
          workspace,
          system,
          text: input.prompt,
          modelId: agent.defaultModelId ? acpModelId(agent.defaultModelId) : null,
          effort: agent.defaultEffort ?? null,
          bytnodeKey: session.bytnodeKey,
          exchangeAccounts: accounts,
          plugins,
        },
        input.signal,
      );
      return text ? { ok: true, text } : { ok: false, error: "The agent produced no answer." };
    }

    if (!session.openrouterKey.trim()) return { ok: false, error: "No OpenRouter key: this agent cannot run." };
    /* No model chosen yet (an agent never opened in a conversation, user
       report 2026-10-08): its vendor's latest, as the chat itself picks. */
    const model = agent.defaultModelId ?? (await latestModelOf(agent.providerId));
    if (!model) return { ok: false, error: `${agent.name} has no model chosen, and OpenRouter's catalog could not be read: open a conversation with it once.` };
    const { tools, bytnode } = await allTools({ engine: "native", platform: process.platform, bytnodeKey: session.bytnodeKey, exchangeAccounts: accounts, depth: 1, plugins });
    const system = [
      buildSystemPrompt(session.profile, agent),
      prof.prompt,
      buildToolsPrompt(workspace, skills, `${process.platform} (${process.arch})`, agent.scope ?? "workspace", bytnode, accounts, 0, true),
      plugged,
      frame,
    ]
      .filter(Boolean)
      .join("\n\n");
    const ctx: Omit<ToolContext, "signal" | "emit" | "callId"> = {
      workspace,
      scope: agent.scope ?? "workspace",
      projectRoot: PROJECT_ROOT,
      depth: 1,
      llm: { apiKey: session.openrouterKey, model, effort: agent.defaultEffort ?? null },
      professionSkills: [...prof.skills, ...extraSkills],
      bytnodeKey: session.bytnodeKey,
      exchangeAccounts: accounts,
      plugins,
      agentId: agent.id,
    };
    const out = await runAgentLoop(
      [
        { role: "system", content: system },
        { role: "user", content: input.prompt },
      ],
      {
        complete: (messages, t, signal) => streamOpenRouter({ apiKey: session.openrouterKey, model, effort: agent.defaultEffort ?? null, messages, tools: t, signal }),
        execute: async (call, signal, emit) => {
          const tool = tools.find((t) => t.name === call.name);
          if (!tool) return { ok: false, output: `Unknown tool: ${call.name}` };
          return tool.execute(call.args, { ...ctx, signal, emit, callId: call.id });
        },
        emit: () => {},
        tools: toToolSpecs(tools),
        maxTurns: TURNS,
        /* A background run reports in text; its model may not accept
           images. Its charts stay on disk and are cited by path — never
           pushed to the model. */
        modelSeesImages: false,
        signal: input.signal,
      },
    );
    const text = out.text.trim();
    return text ? { ok: true, text } : { ok: false, error: "The agent produced no answer." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A vendor's latest model on OpenRouter (public catalog, no key), or null. */
async function latestModelOf(providerId: string): Promise<string | null> {
  try {
    const res = await fetch(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return latestModels(parseOpenRouterModels(await res.json()), providerId, 1)[0]?.id ?? null;
  } catch {
    return null;
  }
}
