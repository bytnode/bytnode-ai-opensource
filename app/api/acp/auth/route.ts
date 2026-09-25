import { isAcpAgentId } from "@/lib/acp/agents";
import { allAuthStatus, authStatus, logout, startLogin } from "@/lib/acp/auth";
import { uninstallAgent } from "@/lib/acp/install";
import { updateAgent } from "@/lib/acp/updates";

/* The state of the accounts behind the subscription agents, and the two
   possible actions: log in (the response comes back right away, the state
   is re-read afterwards), log out. */

export async function GET() {
  return Response.json({ agents: await allAuthStatus() });
}

export async function POST(req: Request) {
  let body: { agent?: string; action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  if (!isAcpAgentId(body.agent)) return Response.json({ error: { message: "Unknown agent." } }, { status: 400 });
  try {
    if (body.action === "login") {
      /* The Gemini login blocks until it finishes; the others return right
         away. In both cases we answer without waiting. */
      void startLogin(body.agent).catch(() => {});
    } else if (body.action === "logout") await logout(body.agent);
    else if (body.action === "install") void updateAgent(body.agent).catch(() => {});
    else if (body.action === "uninstall") await uninstallAgent(body.agent);
    else return Response.json({ error: { message: "Unknown action." } }, { status: 400 });
    return Response.json({ status: await authStatus(body.agent) });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 500 });
  }
}
