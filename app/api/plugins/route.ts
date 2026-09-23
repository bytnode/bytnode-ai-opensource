import { readyRuntime } from "@/lib/plugins/host";
import { resolvePolicy } from "@/lib/tools/policy";

/* The plugins as the running app sees them: each one's state (active,
   disabled, error, blocked) and the tools it provides, with their policy
   — the library shows exactly what each plugin lets an agent do. The
   manifests themselves are in the browser's catalog. */
export async function GET() {
  const runtime = await readyRuntime();
  return Response.json({
    status: runtime.status(),
    tools: runtime.toolsByPlugin().map(({ plugin, tool }) => ({ plugin, name: tool.name, description: tool.description, policy: resolvePolicy(tool.name, tool.policy) })),
  });
}
