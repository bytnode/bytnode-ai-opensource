import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentDir, brokenInstall } from "./launch";

const has =
  (...present: string[]) =>
  (p: string) =>
    present.includes(p);

describe("brokenInstall", () => {
  const dir = agentDir("claude");
  const nm = path.join(dir, "node_modules");
  const lock = path.join(dir, "package-lock.json");

  it("signale un node_modules sans package-lock : npm a ete interrompu", () => {
    expect(brokenInstall("claude", has(nm))).toMatch(/incomplète/);
  });
  it("accepte une installation terminee, ou absente", () => {
    expect(brokenInstall("claude", has(nm, lock))).toBeNull();
    expect(brokenInstall("claude", has())).toBeNull();
  });
  it("ignore un agent telecharge (pas npm)", () => {
    expect(brokenInstall("mistral", has(path.join(agentDir("mistral"), "node_modules")))).toBeNull();
  });
});
