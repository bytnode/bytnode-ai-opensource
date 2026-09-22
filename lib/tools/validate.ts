import type { JsonSchema } from "./types";

/* ---------------------------------------------------------------------------
   Check the arguments of a tool call against its schema.

   The model gets it wrong: a forgotten `path`, a number as text, an action
   outside the list. Without a check, every tool defends itself its own way
   and the model receives a different error every time — or worse, the tool
   runs with an absurd argument. Here: ONE sentence, the first problem in
   schema order, which the model fixes on the next turn.

   Covers what our tools declare (`type`, `required`, `enum`, `items`,
   `minimum`/`maximum`, `pattern`, `additionalProperties: false`, and nested
   objects — the tasks of a Workflow — each property of which is checked in
   turn, named `tasks[1].profession`) — not the whole JSON Schema standard.
   Pure, no dependency.
--------------------------------------------------------------------------- */

type Property = {
  type?: string;
  enum?: unknown[];
  items?: Property;
  properties?: Record<string, Property>;
  required?: string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};

type ObjectSchema = { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };

/** `null` when everything is fine, otherwise the sentence to send back to the model. */
export const validateArgs = (schema: JsonSchema, args: Record<string, unknown>): string | null => validateObject(schema, args, "");

function validateObject(schema: ObjectSchema, args: Record<string, unknown>, prefix: string): string | null {
  const props = (schema.properties ?? {}) as Record<string, Property>;
  for (const name of schema.required ?? []) {
    if (args[name] === undefined || args[name] === null) return `\`${prefix}${name}\` required (${props[name]?.type ?? "value"}).`;
  }
  for (const [name, prop] of Object.entries(props)) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    const problem = check(`${prefix}${name}`, prop, value);
    if (problem) return problem;
  }
  if (schema.additionalProperties === false) {
    const known = Object.keys(props);
    const extra = Object.keys(args).find((k) => !known.includes(k));
    if (extra) return `\`${prefix}${extra}\`: unknown argument (expected: ${known.join(", ")}).`;
  }
  return null;
}

function check(name: string, prop: Property, value: unknown): string | null {
  if (prop.type && !isType(prop.type, value)) return `\`${name}\`: ${prop.type} expected, got ${show(value)}.`;
  if (prop.enum && !prop.enum.includes(value)) return `\`${name}\`: value not in list (${prop.enum.map(String).join(", ")}), got ${show(value)}.`;
  if (typeof value === "number") {
    if (prop.minimum !== undefined && value < prop.minimum) return `\`${name}\`: at least ${prop.minimum}, got ${value}.`;
    if (prop.maximum !== undefined && value > prop.maximum) return `\`${name}\`: at most ${prop.maximum}, got ${value}.`;
  }
  if (typeof value === "string" && prop.pattern && !new RegExp(prop.pattern).test(value)) {
    return `\`${name}\`: does not match the pattern ${prop.pattern}, got ${show(value)}.`;
  }
  if (Array.isArray(value) && prop.items) {
    for (let i = 0; i < value.length; i++) {
      const problem = check(`${name}[${i}]`, prop.items, value[i]);
      if (problem) return problem;
    }
  }
  if (prop.properties && isType("object", value)) {
    const problem = validateObject(prop, value as Record<string, unknown>, `${name}.`);
    if (problem) return problem;
  }
  return null;
}

function isType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/** The received value, kept short: the model must recognise what it sent. */
function show(value: unknown): string {
  const text = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
