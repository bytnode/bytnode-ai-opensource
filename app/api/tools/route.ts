import { allTools, toToolSpecs } from "@/lib/tools/registry";
import { policiesOf } from "@/lib/tools/policy";
import { listSkills } from "@/lib/tools/skills/skill";
import { readTransport } from "@/lib/tools/transport";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import { readyRuntime } from "@/lib/plugins/host";
import { pluginSkills } from "@/lib/plugins/extras";

/* What the browser needs to know before a turn: the resolved workspace,
   the tool specifications (base + BytNode + the agent's plugins) and their
   policies, the profession's prompt, the skills (the plugins' included),
   the state of the data source. The keys, the agent's accounts and its
   plugins arrive in headers (`lib/tools/transport.ts`), never in the URL. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const professionParam = url.searchParams.get("profession");
  const profession = isProfessionId(professionParam) ? professionParam : DEFAULT_PROFESSION;
  const workspace = await resolveWorkspace(agentId, url.searchParams.get("workspace") ?? "");
  const { bytnodeKey, exchangeAccounts, plugins } = readTransport(req.headers);
  const runtime = await readyRuntime();
  const t0 = Date.now();
  const [{ tools, bytnode }, prof, extra] = await Promise.all([
    allTools({ engine: "native", platform: process.platform, bytnodeKey, exchangeAccounts, plugins }),
    loadProfession(PROJECT_ROOT, profession),
    pluginSkills(runtime, plugins),
  ]);
  const skills = await listSkills(workspace, [...prof.skills, ...extra]);
  /* The first call connects to the remote BytNode (tool discovery, then
     cached): that is the one that can take several seconds. */
  console.info(`[tools] tool set ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (BytNode: ${bytnode.ok ? `${bytnode.count} tools` : (bytnode.message ?? "no")})`);
  return Response.json({
    workspace,
    tools: toToolSpecs(tools),
    /* What each tool may do without the user: the browser decides with
       it which call waits for approval. */
    policies: policiesOf(tools),
    skills,
    platform: `${process.platform} (${process.arch})`,
    profession: { id: prof.id, prompt: prof.prompt },
    bytnode,
  });
}
