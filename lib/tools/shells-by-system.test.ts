import { describe, expect, it, vi } from "vitest";

/* macOS / Linux: no PowerShell offered unless `pwsh` is installed — an
   agent on a Mac called it and got "command not found" — and the prompt
   says Bash and `python3`. */

const onPath = { pwsh: false };
vi.mock("@/lib/acp/detect", () => ({ findOnPath: (name: string) => (name === "pwsh" && onPath.pwsh ? "/usr/local/bin/pwsh" : null) }));

const { generalTools } = await import("./registry");
const { buildToolsPrompt } = await import("@/lib/agent/tools-prompt");

const names = (platform: string) => generalTools(platform).map((t) => t.name);

describe("the shells an agent is offered, by system", () => {
  it("Windows: Bash and PowerShell, always", () => {
    expect(names("win32")).toEqual(expect.arrayContaining(["Bash", "PowerShell"]));
  });

  it("macOS / Linux: Bash only, unless pwsh is installed", () => {
    onPath.pwsh = false;
    expect(names("darwin")).toContain("Bash");
    expect(names("darwin")).not.toContain("PowerShell");
    expect(names("linux")).not.toContain("PowerShell");
    onPath.pwsh = true;
    expect(names("darwin")).toContain("PowerShell");
  });

  it("the prompt of a Mac says Bash and python3, never PowerShell by default", () => {
    const mac = buildToolsPrompt("/Users/me/.bytnode-ai/workspaces/a1", [], "darwin (arm64)");
    expect(mac).toContain("Shell: Bash");
    expect(mac).toContain("This is macOS");
    expect(mac).toContain("`python3`");
    expect(mac).not.toContain("Default shell: PowerShell");
    const win = buildToolsPrompt("C:\\Users\\me\\.bytnode-ai\\workspaces\\a1", [], "win32 (x64)");
    expect(win).toContain("Default shell: PowerShell");
  });
});
