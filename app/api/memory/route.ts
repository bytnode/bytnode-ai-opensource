import { resolveWorkspace } from "@/lib/server/workspace";
import { memoryPrompt } from "@/lib/tools/finance/memory";

/* The "Memory" block of an agent's prompt, re-read at every turn: what the
   Memory tool has retained in its workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = await resolveWorkspace(url.searchParams.get("agentId") ?? "", url.searchParams.get("workspace") ?? "");
  return Response.json({ prompt: await memoryPrompt(workspace) });
}
