import { readyRuntime } from "@/lib/plugins/host";
import { userPluginInfos } from "@/lib/plugins/user/info";

/* The plugins written by the user's agents: each one's state, what runs,
   what was granted, what waits for the user's review. */
export async function GET() {
  const runtime = await readyRuntime();
  return Response.json({ plugins: await userPluginInfos(runtime.status()) });
}
