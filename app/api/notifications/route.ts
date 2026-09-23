import { listNotifications, readNotifications, removeNotifications } from "@/lib/plugins/core/notifications";

/* The notification center: `GET` lists (newest first); `POST` marks read
   (`{ read: [ids] | "all" }`) or removes (`{ remove: [ids] | "all" }`). */

export async function GET() {
  return Response.json({ notifications: await listNotifications() });
}

const ids = (v: unknown): string[] | "all" | null => (v === "all" ? "all" : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

export async function POST(req: Request) {
  let body: { read?: unknown; remove?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  const read = ids(body.read);
  const remove = ids(body.remove);
  if (read) await readNotifications(read);
  if (remove) await removeNotifications(remove);
  return Response.json({ notifications: await listNotifications() });
}
