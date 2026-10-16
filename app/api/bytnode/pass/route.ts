/* ⚠️ WITHDRAWN (2026-10-16): this route handed the app's BytNode pass to an
   agent's MCP server. There is no pass any more: that server relays its
   reads through `POST /api/bytnode/read` and never holds a credential.
   Kept answering 410 until the owner deletes the file. */
export function POST() {
  return Response.json({ message: "Gone." }, { status: 410, headers: { "cache-control": "no-store" } });
}
