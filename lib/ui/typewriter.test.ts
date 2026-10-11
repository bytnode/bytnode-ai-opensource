import { describe, expect, it } from "vitest";
import { markdownPrefix, typedLength } from "./typewriter";

describe("Markdown written letter by letter", () => {
  const md = "- **Read the market live**: prices";
  it("an open bold is closed for now, a marker being typed is held back", () => {
    expect(markdownPrefix(md, 3)).toBe("- ");
    expect(markdownPrefix(md, 8)).toBe("- **Read**");
    expect(markdownPrefix(md, 26)).toBe("- **Read the market live**");
    expect(markdownPrefix(md, md.length)).toBe(md);
  });
});

describe("text that writes itself", () => {
  const text = "Hi Ada, welcome to **BytNode-AI**.";

  it("nothing before the start, everything at the end", () => {
    expect(typedLength(text, -50, 40, false)).toBe(0);
    expect(typedLength(text, 60_000, 40, false)).toBe(text.length);
  });

  it("characters at the given speed", () => {
    expect(typedLength(text, 250, 40, false)).toBe(10);
  });

  it("on a word boundary when asked: never half a word of Markdown", () => {
    const n = typedLength(text, 600, 40, true);
    expect(n).toBeLessThanOrEqual(24);
    expect([" ", "\n"]).toContain(text[n]);
  });
});
