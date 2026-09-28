import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/domain/types";
import { STOPPED, isStopped, restoreAfterFailedRecovery } from "./stop";

const msg = (id: string, role: Message["role"], content: string, extra: Partial<Message> = {}): Message => ({ id, role, content, createdAt: 1, ...extra });

describe("restoreAfterFailedRecovery", () => {
  const earlier = [msg("u0", "user", "earlier question"), msg("r0", "assistant", "earlier answer")];
  const compacting = msg("k", "assistant", "partial summ", { compacting: true });
  const taken = [msg("u1", "user", "MY NEW QUESTION"), msg("r1", "assistant", "", { error: "context length exceeded" })];

  it("puts the user's message back, with a reply that says why, and drops the compaction line", () => {
    const out = restoreAfterFailedRecovery([...earlier, compacting], taken, "compacting failed: no credit");
    expect(out.map((m) => m.id)).toEqual(["u0", "r0", "u1", "r1"]);
    expect(out[2].content).toBe("MY NEW QUESTION");
    expect(out[3].error).toBe("compacting failed: no credit");
  });

  it("with nothing taken, only the compaction line goes", () => {
    expect(restoreAfterFailedRecovery([...earlier, compacting], undefined, "x").map((m) => m.id)).toEqual(["u0", "r0"]);
  });
});

describe("isStopped", () => {
  it("tells a stopped reply from an error", () => {
    expect(isStopped({ error: STOPPED })).toBe(true);
    expect(isStopped({ error: "Insufficient credits" })).toBe(false);
    expect(isStopped({})).toBe(false);
  });
});
