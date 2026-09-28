import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/lib/domain/types";
import { CONVERSATIONS_KEY } from "@/lib/storage/repositories";

/* A browser's localStorage with a quota (here 20 kB), and the `storage`
   listeners a real window would call when ANOTHER tab writes. */
const QUOTA = 20_000;
const data = new Map<string, string>();
const listeners: Array<(e: { key: string | null }) => void> = [];
const size = () => [...data.values()].reduce((t, v) => t + v.length, 0);
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (size() - (data.get(k)?.length ?? 0) + v.length > QUOTA) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  },
  addEventListener: (type: string, fn: (e: { key: string | null }) => void) => {
    if (type === "storage") listeners.push(fn);
  },
};
/** Another tab wrote `key`. */
const otherTabWrote = (key: string) => listeners.forEach((l) => l({ key }));

const conv = (id: string, updatedAt: number, text: string): Conversation => ({
  id,
  agentId: "a1",
  title: id,
  modelId: "m",
  createdAt: 1,
  updatedAt,
  messages: [{ id: `${id}-m`, role: "user", content: text, createdAt: 1 }],
});

beforeEach(() => {
  data.clear();
  listeners.length = 0;
  vi.resetModules();
});

describe("conversations store", () => {
  it("storage full, then another conversation is deleted to make room: the unsaved turn is kept, and written", async () => {
    const { saveConversation, removeConversation, getConversation } = await import("./conversations");
    saveConversation(conv("old", 1, "x".repeat(8_000)));
    saveConversation(conv("A", 2, "first turn"));
    const long = "first turn + a long reply " + "y".repeat(15_000);
    saveConversation(conv("A", 3, long)); // does not fit: kept in memory
    expect(getConversation("A")!.messages[0].content).toBe(long);
    removeConversation("old");
    expect(getConversation("A")!.messages[0].content).toBe(long);
    /* The room made, the turn is written. */
    const stored = JSON.parse(data.get(CONVERSATIONS_KEY)!) as Conversation[];
    expect(stored.find((c) => c.id === "A")!.messages[0].content).toBe(long);
  });

  it("storage full: saving ANOTHER conversation does not roll the unsaved one back, and the notice stays", async () => {
    const { saveConversation, getConversation } = await import("./conversations");
    saveConversation(conv("old", 1, "x".repeat(8_000)));
    saveConversation(conv("A", 2, "first turn"));
    const long = "y".repeat(15_000);
    saveConversation(conv("A", 3, long));
    saveConversation(conv("B", 4, "small"));
    expect(getConversation("A")!.messages[0].content).toBe(long);
    expect(getConversation("B")).toBeDefined();
  });

  it("another tab's change is picked up, and a turn streaming here is not clobbered", async () => {
    const { saveConversation, patchLastMessage, getConversation } = await import("./conversations");
    saveConversation(conv("A", 2, "question"));
    /* A turn streams into A in this tab (per frame, not yet written). */
    patchLastMessage("A", (m) => ({ ...m, content: "question (streaming)" }));
    /* The other tab saved a new conversation B (its list still holds the
       old A). */
    const theirs = [conv("B", 5, "from the other tab"), conv("A", 2, "question")];
    data.set(CONVERSATIONS_KEY, JSON.stringify(theirs));
    otherTabWrote(CONVERSATIONS_KEY);
    expect(getConversation("B")?.messages[0].content).toBe("from the other tab");
    expect(getConversation("A")?.messages[0].content).toBe("question (streaming)");
    /* The turn ends: written, and no longer held apart. */
    saveConversation({ ...getConversation("A")!, updatedAt: 6 });
    data.set(CONVERSATIONS_KEY, JSON.stringify([conv("B", 5, "from the other tab")]));
    otherTabWrote(CONVERSATIONS_KEY);
    expect(getConversation("A")).toBeUndefined(); // deleted in the other tab after our save
  });

  it("saving a conversation keeps the other tab's conversations (the list is re-read before writing)", async () => {
    const { saveConversation } = await import("./conversations");
    saveConversation(conv("A", 1, "mine"));
    const stored = JSON.parse(data.get(CONVERSATIONS_KEY)!) as Conversation[];
    data.set(CONVERSATIONS_KEY, JSON.stringify([conv("B", 2, "theirs"), ...stored]));
    saveConversation(conv("A", 3, "mine, later"));
    const after = JSON.parse(data.get(CONVERSATIONS_KEY)!) as Conversation[];
    expect(after.map((c) => c.id).sort()).toEqual(["A", "B"]);
  });
});
