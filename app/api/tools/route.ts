import { allTools, toToolSpecs } from "@/lib/tools/registry";
import { listSkills } from "@/lib/tools/skills/skill";
import { PROJECT_ROOT, resolveWorkspace } from "@/lib/server/workspace";
import { KEY_HEADER } from "@/lib/server/openrouter";
import { loadProfession } from "@/lib/professions/load";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";

/* Ce que le navigateur doit savoir avant un tour : le dossier de travail
   resolu, les specifications des outils (base + BytNode), le prompt et les
   competences de la profession, l'etat de la source de donnees. La cle
   BytNode arrive dans un en-tete, jamais dans l'adresse. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const professionParam = url.searchParams.get("profession");
  const profession = isProfessionId(professionParam) ? professionParam : DEFAULT_PROFESSION;
  const workspace = await resolveWorkspace(agentId, url.searchParams.get("workspace") ?? "");
  const bytnodeKey = req.headers.get(BYTNODE_HEADER) ?? "";
  const [{ tools, bytnode }, prof] = await Promise.all([
    allTools({ platform: process.platform, bytnodeKey }),
    loadProfession(PROJECT_ROOT, profession),
  ]);
  const skills = await listSkills(workspace, PROJECT_ROOT, prof.skills);
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
void KEY_HEADER;
