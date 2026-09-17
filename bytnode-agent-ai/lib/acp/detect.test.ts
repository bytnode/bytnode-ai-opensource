import { describe, expect, it } from "vitest";
import { findOnPath } from "./detect";

const has =
  (...files: string[]) =>
  (p: string) =>
    files.includes(p);

describe("findOnPath", () => {
  it("parcourt PATH dans l'ordre sous Unix", () => {
    const found = findOnPath("gemini", { platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, exists: has("/usr/bin/gemini") });
    expect(found).toBe("/usr/bin/gemini");
  });
  it("essaie PATHEXT sous Windows, et le nom nu", () => {
    const env = { Path: "C:\\nodejs;C:\\Users\\u\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.CMD" };
    const exists = has("C:\\Users\\u\\AppData\\Roaming\\npm\\gemini.CMD");
    expect(findOnPath("gemini", { platform: "win32", env, exists })).toBe("C:\\Users\\u\\AppData\\Roaming\\npm\\gemini.CMD");
  });
  it("rend null quand rien ne correspond", () => {
    expect(findOnPath("grok", { platform: "linux", env: { PATH: "/bin" }, exists: () => false })).toBeNull();
  });
  it("ignore un PATH absent", () => {
    expect(findOnPath("grok", { platform: "linux", env: {}, exists: () => true })).toBeNull();
  });
});
