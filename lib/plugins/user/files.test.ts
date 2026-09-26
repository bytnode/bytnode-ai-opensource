import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeUserPlugin, userPluginIds, userPluginStore, userPluginsDir, writeDraftFile } from "./files";

/* One folder per plugin written by an agent, holding everything of it —
   and the first layout (files and data in two places) moved into it. */

let home: string;
const previous = process.env.BYTNODE_AI_HOME;

beforeEach(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), "bnai-user-files-"));
  process.env.BYTNODE_AI_HOME = home;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.BYTNODE_AI_HOME;
  else process.env.BYTNODE_AI_HOME = previous;
  await fsp.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe("the folder of the plugins written by agents", () => {
  it("is bytnode-plugin-user, one folder per plugin, its data inside", async () => {
    await writeDraftFile("u-journal", "plugin.json", "{}", "a1");
    await userPluginStore("u-journal").write("trades.json", [{ symbol: "BTC/USDT" }]);
    expect(userPluginsDir()).toBe(path.join(home, "bytnode-plugin-user"));
    expect(fs.readdirSync(path.join(home, "bytnode-plugin-user", "u-journal")).sort()).toEqual(["data", "draft", "meta.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(home, "bytnode-plugin-user", "u-journal", "data", "trades.json"), "utf8"))).toEqual([{ symbol: "BTC/USDT" }]);
    /* Its data can never be written over what was granted. */
    expect(() => userPluginStore("u-journal").write("../grant.json", {})).toThrow(/Invalid data file name/);
  });

  it("moves the first layout into it: files and data together, nothing lost", async () => {
    write(path.join(home, "user-plugins", "u-journal", "active", "server.js"), "export function setup() {}");
    write(path.join(home, "user-plugins", "u-journal", "grant.json"), '{"digest":"d"}');
    write(path.join(home, "plugins", "u-journal", "trades.json"), "[1]");
    write(path.join(home, "plugins", "watchlist", "list.json"), "[]");
    expect(await userPluginIds()).toEqual(["u-journal"]);
    const dir = path.join(home, "bytnode-plugin-user", "u-journal");
    expect(fs.readFileSync(path.join(dir, "active", "server.js"), "utf8")).toContain("setup");
    expect(fs.readFileSync(path.join(dir, "data", "trades.json"), "utf8")).toBe("[1]");
    expect(fs.existsSync(path.join(home, "user-plugins"))).toBe(false);
    expect(fs.existsSync(path.join(home, "plugins", "u-journal"))).toBe(false);
    /* A shipped plugin's data stays where it is. */
    expect(fs.existsSync(path.join(home, "plugins", "watchlist", "list.json"))).toBe(true);
  });

  it("deleting keeps the data only when asked", async () => {
    await writeDraftFile("u-journal", "plugin.json", "{}", "a1");
    await userPluginStore("u-journal").write("trades.json", []);
    await removeUserPlugin("u-journal", false);
    expect(fs.readdirSync(path.join(userPluginsDir(), "u-journal"))).toEqual(["data"]);
    await removeUserPlugin("u-journal", true);
    expect(fs.existsSync(path.join(userPluginsDir(), "u-journal"))).toBe(false);
  });
});
