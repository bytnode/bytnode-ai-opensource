import { resolveWorkspace, workspaceError } from "@/lib/server/workspace";
import { memoryPrompt } from "@/lib/tools/finance/memory";

/* The "Memory" block of an agent's prompt, re-read at every turn: what the
   Memory tool has retained in its workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  let workspace: string;
  try {
    workspace = await resolveWorkspace(url.searchParams.get("agentId") ?? "", url.searchParams.get("workspace") ?? "");
  } catch (e) {
    return workspaceError(e);
  }
  return Response.json({ prompt: await memoryPrompt(workspace) });
}
