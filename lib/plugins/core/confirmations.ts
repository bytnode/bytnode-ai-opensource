import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Confirmation } from "@/lib/domain/plugins";
import type { ToolResult } from "@/lib/tools/types";
import { ALWAYS_ASK } from "@/lib/tools/names";
import { dataDir } from "@/lib/server/data-dir";
import type { ConfirmationRequest } from "./contract";
import { addNotification, readConfirmationNotices } from "./notifications";
import { readJson, updateJson } from "./store";

/* ---------------------------------------------------------------------------
   Human confirmation of what commits funds.

   ⚠️ THIS IS A GUARANTEE OF THE CORE. A plugin (a recurring purchase) may
   PREPARE an order; it never places it. `request` parks the call here and
   notifies the user; the notification opens the same permission prompt as
   in the thread — the tool, the order in one line, the LIVE / TESTNET
   badge, "Allow" and "Deny", no "Always". Only the user's click
   (`POST /api/confirmations/<id>`) runs the core tool, once. A request
   nobody answered expires after `EXPIRY_MS`, and only the tools that
   always ask can be parked — this is not a way around a permission.
--------------------------------------------------------------------------- */

export const EXPIRY_MS = 24 * 60 * 60_000;
const MAX_KEPT = 100;

const file = () => path.join(dataDir(), "confirmations.json");

/** Pending ones past their delay become `expired`. Pure. */
export const expire = (list: Confirmation[], now: number): Confirmation[] =>
  list.map((c) => (c.status === "pending" && now - c.at > EXPIRY_MS ? { ...c, status: "expired", outcome: "Not confirmed in time." } : c));

export async function requestConfirmation(plugin: string, request: ConfirmationRequest): Promise<Confirmation> {
  if (!ALWAYS_ASK.has(request.tool)) throw new Error(`Only a tool that always asks can wait for a confirmation (${request.tool} is not one).`);
  const c: Confirmation = { id: randomUUID(), at: Date.now(), plugin, ...request, status: "pending" };
  await updateJson<Confirmation[]>(file(), [], (list) => [c, ...list].slice(0, MAX_KEPT));
  await addNotification(plugin, { title: request.title, body: request.reason, level: "warning", action: { kind: "confirm", confirmationId: c.id } });
  return c;
}

export async function listConfirmations(now = Date.now()): Promise<Confirmation[]> {
  const list = await readJson<Confirmation[]>(file(), []);
  const current = expire(list, now);
  if (current.some((c, i) => c.status !== list[i].status)) await updateJson<Confirmation[]>(file(), [], (l) => expire(l, now));
  return current;
}

/** The user's decision. `run` executes the core tool (the route gives it
    the account the browser sent); it is called at most once per request:
    the status leaves `pending` under the lock, before running. */
export async function decideConfirmation(id: string, allow: boolean, run: (c: Confirmation) => Promise<ToolResult>, now = Date.now()): Promise<Confirmation> {
  let claimed: Confirmation | undefined;
  await updateJson<Confirmation[]>(file(), [], (list) =>
    expire(list, now).map((c) => {
      if (c.id !== id || c.status !== "pending") return c;
      claimed = { ...c, status: allow ? "allowed" : "denied", ...(allow ? {} : { outcome: "Refused by the user." }) };
      return claimed;
    }),
  );
  if (!claimed) {
    const existing = (await readJson<Confirmation[]>(file(), [])).find((c) => c.id === id);
    throw new Error(existing ? `Already decided: ${existing.status}.` : "Unknown confirmation.");
  }
  let decided = claimed;
  if (allow) {
    let result: ToolResult;
    try {
      result = await run(claimed);
    } catch (e) {
      result = { ok: false, output: e instanceof Error ? e.message : String(e) };
    }
    decided = { ...claimed, status: result.ok ? "allowed" : "failed", outcome: result.output };
    await updateJson<Confirmation[]>(file(), [], (list) => list.map((c) => (c.id === id ? decided : c)));
  }
  await readConfirmationNotices(id);
  return decided;
}
