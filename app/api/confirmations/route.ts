import { listConfirmations } from "@/lib/plugins/core/confirmations";

/* The calls parked by plugins, waiting for the user (and the recent
   decisions): the notification center opens them in the permission
   prompt. */
export async function GET() {
  return Response.json({ confirmations: await listConfirmations() });
}
