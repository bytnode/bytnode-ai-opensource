import type { JsonSchema } from "./types";

/* ---------------------------------------------------------------------------
   Verifier les arguments d'un appel d'outil contre son schema.

   Le modele se trompe : un `path` oublie, un nombre en texte, une action
   hors liste. Sans verification, chaque outil se defend a sa maniere et le
   modele recoit une erreur differente a chaque fois — ou pire, l'outil
   tourne avec un argument absurde. Ici : UNE phrase en français, le premier
   probleme dans l'ordre du schema, que le modele corrige au tour suivant.

   Couvre ce que nos outils declarent (`type`, `required`, `enum`, `items`,
   `minimum`/`maximum`, `pattern`, `additionalProperties: false`, et les
   objets imbriques — les taches d'un Workflow — dont chaque propriete est
   verifiee a son tour, nommee `tasks[1].profession`) — pas toute la norme
   JSON Schema. Pur, sans dependance.
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

/** `null` si tout va bien, sinon la phrase a renvoyer au modele. */
export const validateArgs = (schema: JsonSchema, args: Record<string, unknown>): string | null => validateObject(schema, args, "");

function validateObject(schema: ObjectSchema, args: Record<string, unknown>, prefix: string): string | null {
  const props = (schema.properties ?? {}) as Record<string, Property>;
  for (const name of schema.required ?? []) {
    if (args[name] === undefined || args[name] === null) return `\`${prefix}${name}\` requis (${props[name]?.type ?? "valeur"}).`;
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
    if (extra) return `\`${prefix}${extra}\` : argument inconnu (attendus : ${known.join(", ")}).`;
  }
  return null;
}

function check(name: string, prop: Property, value: unknown): string | null {
  if (prop.type && !isType(prop.type, value)) return `\`${name}\` : ${prop.type} attendu, reçu ${show(value)}.`;
  if (prop.enum && !prop.enum.includes(value)) return `\`${name}\` : valeur hors liste (${prop.enum.map(String).join(", ")}), reçu ${show(value)}.`;
  if (typeof value === "number") {
    if (prop.minimum !== undefined && value < prop.minimum) return `\`${name}\` : au moins ${prop.minimum}, reçu ${value}.`;
    if (prop.maximum !== undefined && value > prop.maximum) return `\`${name}\` : au plus ${prop.maximum}, reçu ${value}.`;
  }
  if (typeof value === "string" && prop.pattern && !new RegExp(prop.pattern).test(value)) {
    return `\`${name}\` : ne respecte pas le motif ${prop.pattern}, reçu ${show(value)}.`;
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

/** La valeur reçue, courte : le modele doit reconnaitre ce qu'il a envoye. */
function show(value: unknown): string {
  const text = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
