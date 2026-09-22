import { describe, expect, it } from "vitest";
import { buildCompactRequest, compactLabel, compactionMessage, isCompactCommand, isContextOverflow, transcriptOf } from "./compact";
import type { Message } from "@/lib/domain/types";

const user = (content: string): Message => ({ id: content, role: "user", content, createdAt: 1 });
const agent = (content: string): Message => ({ id: content, role: "assistant", content, createdAt: 2 });

describe("isCompactCommand", () => {
  it("recognises the command, alone or with instructions", () => {
    expect(isCompactCommand("/compact")).toEqual({ instructions: "" });
    expect(isCompactCommand("  /compact  ")).toEqual({ instructions: "" });
    expect(isCompactCommand("/compact keep the price levels")).toEqual({ instructions: "keep the price levels" });
    expect(isCompactCommand("/COMPACT")).toEqual({ instructions: "" });
  });

  it("does not trigger on text that mentions it", () => {
    expect(isCompactCommand("explain /compact to me")).toBeNull();
    expect(isCompactCommand("compact")).toBeNull();
    expect(isCompactCommand("/compacter")).toBeNull();
    expect(isCompactCommand("")).toBeNull();
  });
});

describe("buildCompactRequest", () => {
  it("asks for a structured summary", () => {
    const r = buildCompactRequest("");
    expect(r).toContain("summary");
    expect(r).toMatch(/decisions|Decisions/);
  });

  it("adds the user's instructions when there are any", () => {
    expect(buildCompactRequest("keep the levels")).toContain("keep the levels");
    expect(buildCompactRequest("")).not.toContain("instruction for this summary");
  });
});

describe("transcriptOf", () => {
  it("renders a readable thread, roles named", () => {
    const t = transcriptOf([user("salut"), agent("bonjour")]);
    expect(t).toBe("User: salut\n\nAgent: bonjour");
  });

  it("skips empty messages and bounds the length", () => {
    const long = [user("a".repeat(20_000)), agent("fin")];
    const t = transcriptOf(long, 500);
    expect(t.length).toBeLessThanOrEqual(520);
    expect(t.startsWith("[…]")).toBe(true);
    expect(t).toContain("fin");
    expect(transcriptOf([user(""), agent("seul")])).toBe("Agent: seul");
  });

  it("ignores a compaction in progress (partial summary)", () => {
    const t = transcriptOf([user("salut"), { ...agent("1. Request…"), compacting: true }]);
    expect(t).toBe("User: salut");
  });
});

describe("compactionMessage", () => {
  it("carries the marker and the summary", () => {
    const m = compactionMessage("thread summary", "m1", 42);
    expect(m).toMatchObject({ id: "m1", role: "assistant", content: "thread summary", compaction: true, createdAt: 42 });
    expect(m.steps).toEqual([{ type: "text", text: "thread summary" }]);
  });

  it("remembers who compacted, and the label follows", () => {
    expect(compactionMessage("r", "m", 1).compactedBy).toBe("user");
    expect(compactionMessage("r", "m", 1, "auto").compactedBy).toBe("auto");
    expect(compactLabel(compactionMessage("r", "m", 1))).toBe("Conversation compacted");
    expect(compactLabel(compactionMessage("r", "m", 1, "auto"))).toBe("Conversation compacted automatically — window full");
    expect(compactLabel(compactionMessage("r", "m", 1, "overflow"))).toBe("Conversation compacted automatically — context exceeded");
  });
});

/* The « context exceeded » error is not transient: retrying as is would
   fail the same way. It has to be recognised so as to compact then replay. */
describe("isContextOverflow", () => {
  const err = (message: string, status?: number) => Object.assign(new Error(message), status === undefined ? {} : { status });

  it("recognises the providers' wordings", () => {
    expect(isContextOverflow(err("This endpoint's maximum context length is 128000 tokens. However, you requested about 131000 tokens", 400))).toBe(true);
    expect(isContextOverflow(err("prompt is too long: 213000 tokens > 200000 maximum", 400))).toBe(true);
    expect(isContextOverflow(err("This model's maximum context length is 8192 tokens", 400))).toBe(true);
    expect(isContextOverflow(err("input length and `max_tokens` exceed context limit", 400))).toBe(true);
    expect(isContextOverflow(err("Request too large: too many tokens", 413))).toBe(true);
  });

  it("does not confuse another 400, another error, nor a deliberate stop", () => {
    expect(isContextOverflow(err("Invalid model id", 400))).toBe(false);
    expect(isContextOverflow(err("context length exceeded", 500))).toBe(false);
    expect(isContextOverflow(err("The provider answered 400.", 400))).toBe(false);
    expect(isContextOverflow(new DOMException("Interrupted", "AbortError"))).toBe(false);
    expect(isContextOverflow(null)).toBe(false);
  });

  it("accepts the message alone when the status is missing", () => {
    expect(isContextOverflow(err("maximum context length is 32000 tokens"))).toBe(true);
  });
});
