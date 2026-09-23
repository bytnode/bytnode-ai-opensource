import { describe, expect, it } from "vitest";
import { nextVersion } from "./next-version";

describe("nextVersion", () => {
  it("keeps a version nobody published, above the registry", () => {
    expect(nextVersion("0.1.3", ["0.1.0", "0.1.1", "0.1.2"])).toBe("0.1.3");
    expect(nextVersion("0.2.0", ["0.1.0", "0.1.2"])).toBe("0.2.0");
  });

  it("keeps the version of a package never published", () => {
    expect(nextVersion("0.1.0", [])).toBe("0.1.0");
  });

  it("moves an already published version to the next patch", () => {
    expect(nextVersion("0.1.2", ["0.1.0", "0.1.1", "0.1.2"])).toBe("0.1.3");
  });

  it("goes past the highest published version when the local one is behind", () => {
    expect(nextVersion("0.1.1", ["0.1.0", "0.1.1", "0.1.2", "0.1.3"])).toBe("0.1.4");
    expect(nextVersion("0.1.9", ["0.1.9", "0.1.10"])).toBe("0.1.11");
  });

  it("ignores prereleases when looking for the highest stable version", () => {
    expect(nextVersion("0.1.3", ["0.1.2", "0.1.4-beta.0"])).toBe("0.1.3");
  });

  it("leaves a free prerelease alone and refuses a taken one", () => {
    expect(nextVersion("0.1.4-beta.1", ["0.1.4-beta.0"])).toBe("0.1.4-beta.1");
    expect(() => nextVersion("0.1.4-beta.0", ["0.1.4-beta.0"])).toThrow(/already published/);
  });
});
