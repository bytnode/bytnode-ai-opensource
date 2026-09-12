import { isAcpAgentId } from "@/lib/acp/agents";
import { allAuthStatus, authStatus, logout, startLogin } from "@/lib/acp/auth";
import { installAgent, uninstallAgent } from "@/lib/acp/install";

/* L'etat des comptes derriere les agents par abonnement, et les deux
   actions possibles : se connecter (la reponse revient tout de suite,
   l'etat se relit ensuite), se deconnecter. */

export async function GET() {
  return Response.json({ agents: await allAuthStatus() });
}

export async function POST(req: Request) {
  let body: { agent?: string; action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  if (!isAcpAgentId(body.agent)) return Response.json({ error: { message: "Agent inconnu." } }, { status: 400 });
  try {
    if (body.action === "login") {
      /* La connexion Gemini bloque jusqu'a la fin ; les autres rendent la
         main tout de suite. Dans les deux cas on repond sans attendre. */
      void startLogin(body.agent).catch(() => {});
    } else if (body.action === "logout") await logout(body.agent);
    else if (body.action === "install") void installAgent(body.agent).catch(() => {});
    else if (body.action === "uninstall") await uninstallAgent(body.agent);
    else return Response.json({ error: { message: "Action inconnue." } }, { status: 400 });
    return Response.json({ status: await authStatus(body.agent) });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 500 });
  }
}
