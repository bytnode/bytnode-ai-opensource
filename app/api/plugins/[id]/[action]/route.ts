import { actionStatus } from "@/lib/plugins/core/errors";
import { readyRuntime } from "@/lib/plugins/host";
import { readTransport } from "@/lib/tools/transport";

/* An action of a plugin's view: `POST /api/plugins/<id>/<action>` with a
   JSON object of parameters; the keys and accounts travel in the usual
   headers. The answer is `{ result }` or `{ error: { message } }` — 400 for
   what the action refused, 404 for an unknown id, 500 for a real fault
   (`actionStatus`). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const runtime = await readyRuntime();
  const handler = runtime.handler(id, action);
  if (!handler) {
    const message = runtime.isRunning(id) ? `${id} has no action ${action}.` : `The plugin ${id} is not running.`;
    return Response.json({ error: { message } }, { status: 404 });
  }
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  const input = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  try {
    return Response.json({ result: await handler(input, { transport: readTransport(req.headers), signal: req.signal }) });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: actionStatus(e) });
  }
}
