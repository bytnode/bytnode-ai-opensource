import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkUserPlugin, reportText } from "./check";
import { writeDraftFile } from "./files";

/* ⚠️ THE SKILL TEACHES WHAT PASSES. The create-plugin skill's examples are
   what agents copy: each one must pass PluginCheck exactly as shipped —
   its manifest, its code, its own tests, its page. */

const EXAMPLES = path.join(process.cwd(), "professions", "_commun", "skills", "create-plugin", "examples");

let home: string;
const previous = process.env.BYTNODE_AI_HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-skill-examples-"));
  process.env.BYTNODE_AI_HOME = home;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.BYTNODE_AI_HOME;
  else process.env.BYTNODE_AI_HOME = previous;
  await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function filesOf(dir: string, prefix = ""): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await filesOf(path.join(dir, e.name), `${prefix}${e.name}/`)));
    else out.push([`${prefix}${e.name}`, await fs.readFile(path.join(dir, e.name), "utf8")]);
  }
  return out;
}

describe("the create-plugin skill's examples", { timeout: 30_000 }, async () => {
  const names = (await fs.readdir(EXAMPLES)).sort();

  it("are the three the skill names", () => {
    expect(names).toEqual(["fear-greed", "price-watch", "rebalance"]);
  });

  it.each(names)("%s passes PluginCheck as shipped", async (name) => {
    const id = `u-${name}`;
    for (const [file, text] of await filesOf(path.join(EXAMPLES, name))) await writeDraftFile(id, file, text, "test");
    const report = await checkUserPlugin(id, { taken: new Map() });
    expect(report.ok, reportText(report)).toBe(true);
  });
});
