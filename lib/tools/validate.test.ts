import { describe, expect, test } from "vitest";
import { invalidCall, validateArgs } from "./validate";
import type { JsonSchema } from "./types";

/* An ill-formed call must come back to the model as one sentence it can
   fix, without running the tool or bothering the user. */

const schema: JsonSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "The file." },
    limit: { type: "integer", minimum: 1, maximum: 500 },
    ratio: { type: "number" },
    dry: { type: "boolean" },
    action: { type: "string", enum: ["add", "search", "list"] },
    tags: { type: "array", items: { type: "string" } },
    slug: { type: "string", pattern: "^[a-z-]+$" },
  },
  required: ["path"],
  additionalProperties: false,
};

describe("validateArgs", () => {
  test("accepts conforming arguments", () => {
    expect(validateArgs(schema, { path: "a.md", limit: 10, ratio: 0.5, dry: true, action: "add", tags: ["x"], slug: "ok-slug" })).toBeNull();
  });

  test("reports a missing required argument, with its type", () => {
    expect(validateArgs(schema, {})).toBe("`path` required (string).");
  });

  test("reports a wrong type by showing the received value", () => {
    expect(validateArgs(schema, { path: 12 })).toBe("`path`: string expected, got 12.");
    expect(validateArgs(schema, { path: "a", limit: "abc" })).toBe("`limit`: integer expected, got \"abc\".");
    expect(validateArgs(schema, { path: "a", limit: 1.5 })).toBe("`limit`: integer expected, got 1.5.");
    expect(validateArgs(schema, { path: "a", dry: "yes" })).toBe("`dry`: boolean expected, got \"yes\".");
    expect(validateArgs(schema, { path: "a", tags: "x" })).toBe("`tags`: array expected, got \"x\".");
  });

  test("checks the items of an array", () => {
    expect(validateArgs(schema, { path: "a", tags: ["x", 3] })).toBe("`tags[1]`: string expected, got 3.");
  });

  test("checks a list of values, the bounds and a pattern", () => {
    expect(validateArgs(schema, { path: "a", action: "drop" })).toBe("`action`: value not in list (add, search, list), got \"drop\".");
    expect(validateArgs(schema, { path: "a", limit: 0 })).toBe("`limit`: at least 1, got 0.");
    expect(validateArgs(schema, { path: "a", limit: 900 })).toBe("`limit`: at most 500, got 900.");
    expect(validateArgs(schema, { path: "a", slug: "Nope!" })).toBe("`slug`: does not match the pattern ^[a-z-]+$, got \"Nope!\".");
  });

  test("refuses an unknown argument when the schema closes the door", () => {
    expect(validateArgs(schema, { path: "a", extra: 1 })).toBe("`extra`: unknown argument (expected: path, limit, ratio, dry, action, tags, slug).");
  });

  test("tolerates an unknown argument when the schema says nothing", () => {
    expect(validateArgs({ type: "object", properties: { a: { type: "string" } } }, { a: "x", b: 1 })).toBeNull();
  });

  test("an absent or null optional argument passes", () => {
    expect(validateArgs(schema, { path: "a", limit: undefined, dry: null })).toBeNull();
  });

  test("reports only the first problem, in schema order", () => {
    expect(validateArgs(schema, { limit: "x" })).toBe("`path` required (string).");
  });

  test("descends into the objects of an array and names them by index", () => {
    const nested: JsonSchema = {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, profession: { type: "string", enum: ["standard", "analyste"] } },
            required: ["title", "profession"],
          },
        },
      },
      required: ["tasks"],
    };
    expect(validateArgs(nested, { tasks: [{ title: "a", profession: "analyste" }] })).toBeNull();
    expect(validateArgs(nested, { tasks: [{ title: "a", profession: "analyste" }, { title: "b" }] })).toBe("`tasks[1].profession` required (string).");
    expect(validateArgs(nested, { tasks: [{ title: "a", profession: "trader" }] })).toBe("`tasks[0].profession`: value not in list (standard, analyste), got \"trader\".");
    expect(validateArgs(nested, { tasks: ["a"] })).toBe("`tasks[0]`: object expected, got \"a\".");
  });
});

/* `/api/tools/execute` checks the call too: callers that skip the agent
   loop must not hand a tool arguments outside its schema. */
describe("invalidCall", () => {
  const chart = {
    name: "Chart",
    parameters: {
      type: "object" as const,
      properties: { file: { type: "string" }, width: { type: "integer", minimum: 320, maximum: 2400 }, height: { type: "integer", minimum: 200, maximum: 1600 } },
      required: ["file"],
      additionalProperties: false,
    },
  };
  test("refuses a value past the schema's bounds", () => {
    expect(invalidCall(chart, { file: "a.csv", width: 100000, height: 100000 })).toBe("Invalid arguments for Chart: `width`: at most 2400, got 100000. Fix the call.");
  });
  test("refuses arguments that are not an object", () => {
    for (const args of [null, "x", 3, ["a"]]) expect(invalidCall(chart, args)).toBe("Invalid arguments for Chart: the arguments must be a JSON object. Fix the call.");
  });
  test("lets a valid call through", () => {
    expect(invalidCall(chart, { file: "a.csv", width: 800 })).toBeNull();
  });
});
