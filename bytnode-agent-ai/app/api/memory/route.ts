import { resolveWorkspace } from "@/lib/server/workspace";
import { memoryPrompt } from "@/lib/tools/finance/memory";

/* Le bloc « Memoire » du prompt d'un agent, relu a chaque tour : ce que
   l'outil Memory a retenu dans son dossier de travail. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = await resolveWorkspace(url.searchParams.get("agentId") ?? "", url.searchParams.get("workspace") ?? "");
  return Response.json({ prompt: await memoryPrompt(workspace) });
}
