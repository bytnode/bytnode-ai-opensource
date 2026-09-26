import { pluginHost } from "@/lib/plugins/host";
import { userPluginInfos } from "@/lib/plugins/user/info";

/* The plugins written by the user's agents: each one's state, what runs,
   what was granted, what waits for the user's review. Read from disk
   without waiting for the runtime to have started them all (a reload of
   the server): the tabs need the list at once; a start failure shows at
   the next read. */
export async function GET() {
  return Response.json({ plugins: await userPluginInfos(pluginHost().runtime.status()) });
}
