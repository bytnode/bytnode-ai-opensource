import { describe, expect, it } from "vitest";
import { failureOf, isLoginCode, plainText, signInUrl } from "./claude-login";

const OUT = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz\nPaste code here if prompted > ";

describe("Claude sign-in in the app", () => {
  it("reads the sign-in address the CLI prints", () => {
    expect(signInUrl(OUT)).toBe("https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz");
    expect(signInUrl("Opening browser to sign in…\n")).toBeNull();
  });
  it("reads it through a terminal hyperlink and colours", () => {
    const wrapped = "If the browser didn't open, visit: \x1b]8;;https://claude.ai/oauth/x?s=1\x07\x1b[36mhttps://claude.ai/oauth/x?s=1\x1b[39m\x1b]8;;\x07\n";
    expect(plainText(wrapped)).toBe("If the browser didn't open, visit: https://claude.ai/oauth/x?s=1\n");
    expect(signInUrl(wrapped)).toBe("https://claude.ai/oauth/x?s=1");
  });
  it("accepts only a whole code: <code>#<state>", () => {
    expect(isLoginCode("  AbC-123_x#st4te  ")).toBe(true);
    expect(isLoginCode("AbC123")).toBe(false);
    expect(isLoginCode("AbC#")).toBe(false);
    expect(isLoginCode("a b#c")).toBe(false);
    expect(isLoginCode("a#b#c")).toBe(false);
  });
  it("tells why it failed, without the prompts", () => {
    expect(failureOf("OAuth error: invalid_grant\n", OUT, 1)).toBe("OAuth error: invalid_grant");
    expect(failureOf("", "", 1)).toBe("Claude's sign-in stopped (exit 1).");
  });
});
