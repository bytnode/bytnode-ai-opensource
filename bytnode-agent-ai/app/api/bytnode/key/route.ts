import { checkBytnodeKey } from "@/lib/mcp/bytnode";

/* Verifie une cle BytNode : la connexion MCP aboutit et rend ses outils. */
export async function GET(req: Request) {
  const key = req.headers.get("x-bytnode-key") ?? "";
  if (!key.trim()) return Response.json({ error: { message: "Aucune clé BytNode fournie." } }, { status: 401 });
  const r = await checkBytnodeKey(key);
  if (!r.ok) return Response.json({ error: { message: r.message } }, { status: 401 });
  return Response.json({ ok: true, tools: r.tools });
}
