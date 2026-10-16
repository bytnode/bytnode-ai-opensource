import { LINK_HEADER } from "@/lib/bytnode/app-pass";
import { relayRead } from "@/lib/bytnode/app-relay";

/* A built-in plugin's read of BytNode, for an MCP server this server started
   for a subscription agent (the plugins' tools run there:
   `lib/mcp/finance-server.ts`). That process holds no credential: this
   server reads for it, on the plugins' routes only, and answers with the
   data (`lib/bytnode/app-relay.ts`). */
export async function POST(req: Request) {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const { status, body } = await relayRead(req.headers.get(LINK_HEADER), raw, req.signal);
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
