import type { SlashCommand } from "@/lib/agent/commands";
import type { Model } from "@/lib/domain/types";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { AcpConnection } from "./connection";
import { prepareWorkspace, scratchWorkspace } from "./prepare";
import { modelsOfSession, modesOfSession, type AgentModes } from "./translate";

/* What a subscription agent offers: its models, its modes and its own
   commands (`/goal`, `/usage`… — published a moment after the session
   opens, hence the short wait).

   An ACP agent only publishes them when a session opens: we open a
   throwaway one in a neutral folder, read its options, close it. A few
   seconds — hence the cache, per agent, for one hour. */

export type AgentOffer = { models: Model[]; modes: AgentModes | null; commands: SlashCommand[] };

/** How long the discovery waits for the command list after `session/new`
    (Claude sends it at once, Codex after listing its skills). */
const COMMANDS_WAIT = 4000;

const TTL = 60 * 60_000;
const cache = new Map<AcpAgentId, { at: number; offer: AgentOffer }>();
const inflight = new Map<AcpAgentId, Promise<AgentOffer>>();

export function discoverOffer(agent: AcpAgentId, force = false): Promise<AgentOffer> {
  const hit = cache.get(agent);
  if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.offer);
  const running = inflight.get(agent);
  if (running) return running;
  const p = (async () => {
    const cwd = await scratchWorkspace();
    await prepareWorkspace(agent, cwd);
    const conn = await AcpConnection.open(agent, cwd);
    try {
      const created = await conn.newSession(cwd, [], discoveryMeta(agent));
      const res = created as Parameters<typeof modelsOfSession>[1];
      const offer: AgentOffer = {
        models: modelsOfSession(agent, res, acpAgentInfo(agent).staticEfforts),
        modes: modesOfSession(res),
        commands: (await conn.waitForCommands(created.sessionId, COMMANDS_WAIT)) ?? [],
      };
      cache.set(agent, { at: Date.now(), offer });
      return offer;
    } finally {
      conn.close();
      inflight.delete(agent);
    }
  })();
  inflight.set(agent, p);
  return p;
}

export const forgetOffer = (agent: AcpAgentId) => cache.delete(agent);

/** Claude reads the same settings as in a conversation (`sessionMeta` in
    `sessions.ts`): the project's, not the user's personal ones — so the
    commands offered are the ones a conversation's session will have. */
const discoveryMeta = (agent: AcpAgentId): Record<string, unknown> | undefined =>
  agent === "claude" ? { claudeCode: { options: { settingSources: ["project", "local"], strictMcpConfig: true } } } : undefined;
