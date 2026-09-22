import { describe, expect, it } from "vitest";
import { findOnPath } from "./detect";

const has =
  (...files: string[]) =>
  (p: string) =>
    files.includes(p);

describe("findOnPath", () => {
  it("walks PATH in order on Unix", () => {
    const found = findOnPath("gemini", { platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, exists: has("/usr/bin/gemini") });
    expect(found).toBe("/usr/bin/gemini");
  });
  it("tries PATHEXT on Windows, then the bare name", () => {
    const env = { Path: "C:\\nodejs;C:\\Users\\u\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.CMD" };
    const exists = has("C:\\Users\\u\\AppData\\Roaming\\npm\\gemini.CMD");
    expect(findOnPath("gemini", { platform: "win32", env, exists })).toBe("C:\\Users\\u\\AppData\\Roaming\\npm\\gemini.CMD");
  });
  it("returns null when nothing matches", () => {
    expect(findOnPath("grok", { platform: "linux", env: { PATH: "/bin" }, exists: () => false })).toBeNull();
  });
  it("ignores a missing PATH", () => {
    expect(findOnPath("grok", { platform: "linux", env: {}, exists: () => true })).toBeNull();
  });
});
