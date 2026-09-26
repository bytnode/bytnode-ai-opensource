import { describe, expect, it } from "vitest";
import { installHint, pythonCandidates } from "./python";

const none = () => null;
const nothing = () => false;

describe("pythonCandidates", () => {
  it("Windows: python, the py launcher, python3", () => {
    expect(pythonCandidates({ platform: "win32", find: none, exists: nothing })).toEqual(["python", "py", "python3"]);
  });

  it("Linux: python3 first — plain python often does not exist", () => {
    expect(pythonCandidates({ platform: "linux", find: none, exists: nothing })).toEqual(["python3", "python"]);
  });

  it("macOS: Homebrew's Python before the PATH's", () => {
    const exists = (p: string) => p === "/opt/homebrew/bin/python3";
    const find = (n: string) => (n === "python3" ? "/opt/homebrew/bin/python3" : null);
    expect(pythonCandidates({ platform: "darwin", find, exists })).toEqual(["/opt/homebrew/bin/python3"]);
  });

  it("macOS: never Apple's stub without the Command Line Tools (it opens a dialog)", () => {
    const find = (n: string) => (n === "python3" ? "/usr/bin/python3" : null);
    expect(pythonCandidates({ platform: "darwin", find, exists: nothing })).toEqual([]);
    const withTools = (p: string) => p === "/Library/Developer/CommandLineTools/usr/bin/python3";
    expect(pythonCandidates({ platform: "darwin", find, exists: withTools })).toEqual(["/usr/bin/python3"]);
  });
});

describe("installHint", () => {
  it("names the system's own way", () => {
    expect(installHint("darwin", "python3")).toContain("python3 -m pip install pandas numpy");
    expect(installHint("linux", "python3")).toContain("python3-pandas");
  });
});
