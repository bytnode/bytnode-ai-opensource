import { ACP_AGENTS, isAcpAgentId } from "@/lib/acp/agents";
import { authStatus } from "@/lib/acp/auth";
import { discoverOffer } from "@/lib/acp/models";
import type { AgentModes } from "@/lib/acp/translate";
import type { Model } from "@/lib/domain/types";

/* Les modeles ET les modes des agents par abonnement connectes — ou d'un
   seul, avec `?agent=`. Un agent non connecte n'est pas interroge : il
   refuserait. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const only = url.searchParams.get("agent");
  const force = url.searchParams.get("force") === "1";
  const ids = only ? (isAcpAgentId(only) ? [only] : []) : ACP_AGENTS.map((a) => a.id);
  const models: Model[] = [];
  const modes: Record<string, AgentModes> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const status = await authStatus(id);
      if (!status.loggedIn) return;
      try {
        const offer = await discoverOffer(id, force);
        models.push(...offer.models);
        if (offer.modes) modes[id] = offer.modes;
      } catch (e) {
        errors[id] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return Response.json({ models, modes, errors });
}
