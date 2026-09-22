import { checkBytnodeKey } from "@/lib/mcp/bytnode";

/* Checks a BytNode key: the MCP connection succeeds and returns its tools. */
export async function GET(req: Request) {
  const key = req.headers.get("x-bytnode-key") ?? "";
  if (!key.trim()) return Response.json({ error: { message: "No BytNode key provided." } }, { status: 401 });
  const r = await checkBytnodeKey(key);
  if (!r.ok) return Response.json({ error: { message: r.message } }, { status: 401 });
  return Response.json({ ok: true, tools: r.tools });
}
