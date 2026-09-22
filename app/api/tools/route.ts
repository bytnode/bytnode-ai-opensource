import { allTools, toToolSpecs } from "@/lib/tools/registry";
import { listSkills } from "@/lib/tools/skills/skill";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { KEY_HEADER } from "@/lib/server/openrouter";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import { parseAccountsHeader } from "@/lib/tools/exchange/accounts";

/* What the browser needs to know before a turn: the resolved workspace,
   the tool specifications (base + BytNode), the profession's prompt and
   skills, the state of the data source. The BytNode key arrives in a
   header, never in the URL. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const professionParam = url.searchParams.get("profession");
  const profession = isProfessionId(professionParam) ? professionParam : DEFAULT_PROFESSION;
  const workspace = await resolveWorkspace(agentId, url.searchParams.get("workspace") ?? "");
  const bytnodeKey = req.headers.get(BYTNODE_HEADER) ?? "";
  const exchangeAccounts = parseAccountsHeader(req.headers.get(EXCHANGE_HEADER));
  const t0 = Date.now();
  const [{ tools, bytnode }, prof] = await Promise.all([
    allTools({ platform: process.platform, bytnodeKey, exchangeAccounts }),
    loadProfession(PROJECT_ROOT, profession),
  ]);
  const skills = await listSkills(workspace, prof.skills);
  /* The first call connects to the remote BytNode (tool discovery, then
     cached): that is the one that can take several seconds. */
  console.info(`[tools] tool set ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (BytNode: ${bytnode.ok ? `${bytnode.count} tools` : (bytnode.message ?? "no")})`);
  return Response.json({
    workspace,
    tools: toToolSpecs(tools),
    skills,
    platform: `${process.platform} (${process.arch})`,
    profession: { id: prof.id, prompt: prof.prompt },
    bytnode,
  });
}

export const BYTNODE_HEADER = "x-bytnode-key";
/** The exchange accounts the agent is allowed to use, as JSON. Never logged. */
export const EXCHANGE_HEADER = "x-exchange-accounts";
void KEY_HEADER;
