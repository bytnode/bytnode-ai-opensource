import type { Model } from "@/lib/domain/types";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { AcpConnection } from "./connection";
import { prepareWorkspace, scratchWorkspace } from "./prepare";
import { modelsOfSession, modesOfSession, type AgentModes } from "./translate";

/* Ce qu'un agent par abonnement propose : ses modeles et ses modes.

   Un agent ACP ne les publie qu'a l'ouverture d'une session : on en ouvre
   une, jetable, dans un dossier neutre, on lit ses options, on referme.
   Quelques secondes — d'ou le cache, par agent, pour une heure. */

export type AgentOffer = { models: Model[]; modes: AgentModes | null };

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
      const res = (await conn.newSession(cwd, [])) as Parameters<typeof modelsOfSession>[1];
      const offer: AgentOffer = {
        models: modelsOfSession(agent, res, acpAgentInfo(agent).staticEfforts),
        modes: modesOfSession(res),
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
