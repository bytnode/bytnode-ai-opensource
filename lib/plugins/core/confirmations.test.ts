import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppNotification } from "@/lib/domain/plugins";
import { EXPIRY_MS, decideConfirmation, expire, listConfirmations, requestConfirmation } from "./confirmations";
import { addNotification, listNotifications, markRead, pushNotification, readNotifications, removeNotifications } from "./notifications";
import { SessionHolder, TTL_MS } from "./session";
import type { Session } from "./contract";

let home: string;
const previous = process.env.BYTNODE_AI_HOME;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-core-"));
  process.env.BYTNODE_AI_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.BYTNODE_AI_HOME;
  else process.env.BYTNODE_AI_HOME = previous;
  await fs.rm(home, { recursive: true, force: true });
});

const order = { tool: "PlaceOrder", args: { symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 100 }, accountId: "x1", title: "DCA purchase ready", reason: "100 USDT of BTC, weekly plan." };

describe("notifications", () => {
  it("newest first, bounded; read marks", () => {
    const n = (id: string) => ({ id, at: 0, plugin: "p", title: id, body: "", level: "info", read: false }) as AppNotification;
    const list = pushNotification(pushNotification([n("a")], n("b")), n("c"), 2);
    expect(list.map((x) => x.id)).toEqual(["c", "b"]);
    expect(markRead(list, ["b"]).map((x) => x.read)).toEqual([false, true]);
    expect(markRead(list, "all").every((x) => x.read)).toBe(true);
  });

  it("stored on disk, read, removed", async () => {
    await addNotification("alerts", { title: "BTC ≥ 70 000", body: "Crossed at 70 012.", level: "success" });
    await addNotification("scheduler", { title: "Morning brief", body: "Done." });
    expect((await listNotifications()).map((n) => [n.plugin, n.level, n.read])).toEqual([
      ["scheduler", "info", false],
      ["alerts", "success", false],
    ]);
    await readNotifications("all");
    expect((await listNotifications()).every((n) => n.read)).toBe(true);
    await removeNotifications("all");
    expect(await listNotifications()).toEqual([]);
  });
});

describe("confirmations", () => {
  it("only a tool that always asks can be parked", async () => {
    await expect(requestConfirmation("dca", { ...order, tool: "CancelOrder" })).rejects.toThrow(/Only a tool that always asks/);
    await expect(requestConfirmation("dca", { ...order, tool: "Bash" })).rejects.toThrow(/Only a tool that always asks/);
  });

  it("parks the call and notifies; runs it once, on the user's click", async () => {
    const c = await requestConfirmation("dca", order);
    expect(c.status).toBe("pending");
    const notices = await listNotifications();
    expect(notices[0].action).toEqual({ kind: "confirm", confirmationId: c.id });

    const run = vi.fn(async () => ({ ok: true, output: "Order #1 closed" }));
    const decided = await decideConfirmation(c.id, true, run);
    expect(decided).toMatchObject({ status: "allowed", outcome: "Order #1 closed" });
    expect(run).toHaveBeenCalledOnce();
    await expect(decideConfirmation(c.id, true, run)).rejects.toThrow(/Already decided: allowed/);
    expect(run).toHaveBeenCalledOnce();
    expect((await listNotifications())[0].read).toBe(true);
  });

  it("a refusal runs nothing; a failure is recorded", async () => {
    const a = await requestConfirmation("dca", order);
    const run = vi.fn(async () => ({ ok: false, output: "Insufficient balance." }));
    expect(await decideConfirmation(a.id, false, run)).toMatchObject({ status: "denied" });
    expect(run).not.toHaveBeenCalled();
    const b = await requestConfirmation("dca", order);
    expect(await decideConfirmation(b.id, true, run)).toMatchObject({ status: "failed", outcome: "Insufficient balance." });
  });

  it("a request nobody answered expires and can no longer run", async () => {
    const c = await requestConfirmation("dca", order);
    const later = c.at + EXPIRY_MS + 1;
    expect(expire([c], later)[0].status).toBe("expired");
    expect((await listConfirmations(later))[0].status).toBe("expired");
    await expect(decideConfirmation(c.id, true, async () => ({ ok: true, output: "" }), later)).rejects.toThrow(/Already decided: expired/);
  });
});

describe("SessionHolder", () => {
  it("keeps the keys while a tab speaks, drops them after", () => {
    const s = new SessionHolder();
    const session = { bytnodeKey: "bn" } as Session;
    s.set(session, 1000);
    expect(s.get(1000 + TTL_MS)).toBe(session);
    expect(s.get(1001 + TTL_MS)).toBeNull();
    expect(s.get(1000)).toBeNull();
  });
});
