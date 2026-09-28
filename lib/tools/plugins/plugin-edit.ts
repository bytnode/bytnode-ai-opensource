import { manifestOf, readFiles, writeDraftFile } from "@/lib/plugins/user/files";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { PLUGIN_PROP, pluginArg } from "./common";
import { goLive } from "./plugin-write";

/* ---------------------------------------------------------------------------
   PluginEdit: a TARGETED change to one file of a plugin's draft.

   PluginWrite rewrites a file whole; PluginEdit replaces only the fragments
   given — a label, a threshold, a sentence — so the agent changes what the
   user disliked without re-emitting the whole file.

   Every edit is diagnosed ON ITS OWN, before anything is written, and the
   report lists each one with its outcome — never a whole batch lost over one
   comma. Two modes, the caller's choice:
   - `atomic` (one edit's default): all or nothing — if ANY edit fails, no
     change is written, and the report names every edit;
   - `best-effort` (the default for a batch of two or more): the edits that
     pass are applied, the others are reported with their cause.

   Causes: "not found" (the text does not appear), "appears N times" (more
   than one occurrence without `replaceAll`), "old and new are identical"
   (a no-op, refused as such before it can sink the batch). Fragments are
   matched literally, never as a regex. A file changed this way is a new
   version of the draft: it goes LIVE under the same rule as PluginWrite.
--------------------------------------------------------------------------- */

type Edit = { old: string; new: string; replaceAll?: boolean };
type Mode = "atomic" | "best-effort";
type Args = { plugin: string; file: string; edits: Edit[]; mode?: Mode };

/** What one edit is, once its shape and its occurrence are known. */
type Outcome =
  | { applied: true; text: string }
  | { applied: false; cause: string };

const clip = (s: string) => `« ${s.length > 88 ? `${s.slice(0, 88)}…` : s} »`;

/** One edit against the current text: applies it, or says why not. */
function applyOne(edit: Edit, index: number, text: string): Outcome {
  const where = `edit ${index + 1}`;
  if (typeof edit?.old !== "string" || typeof edit?.new !== "string") return { applied: false, cause: `${where}: \`old\` and \`new\` are required, both strings.` };
  if (edit.old === "") return { applied: false, cause: `${where}: \`old\` is empty — give the exact text to replace.` };
  if (edit.old === edit.new) return { applied: false, cause: `${where}: no-op — old and new are identical.` };
  const parts = text.split(edit.old);
  const count = parts.length - 1;
  if (count === 0) return { applied: false, cause: `${where}: not found — ${clip(edit.old)} does not appear. PluginRead the file and copy the fragment exactly.` };
  if (count > 1 && !edit.replaceAll) return { applied: false, cause: `${where}: appears ${count} times — ${clip(edit.old)}. Widen it so it is unique, or set \`replaceAll: true\`. ` };
  /* Literal, never a regex (a code fragment may hold (), $, \), and a
     replacer function so `$&` sequences in the new text stay literal. */
  return { applied: true, text: edit.replaceAll ? parts.join(edit.new) : text.replace(edit.old, () => edit.new) };
}

/** The report's per-edit lines, and the text/time each of them applies. */
function run(edits: Edit[], start: string, mode: Mode): { lines: string[]; text: string; applied: number } {
  let text = start;
  const lines: string[] = [];
  let applied = 0;
  for (let i = 0; i < edits.length; i++) {
    const o = applyOne(edits[i], i, text);
    if (o.applied) {
      text = o.text;
      applied++;
      lines.push(`edit ${i + 1}: applied`);
    } else {
      lines.push(`edit ${i + 1}: ${o.cause}`);
    }
    /* `atomic`: stop at the first failure — the report below still names the
       edits that follow as not applied. */
    if (mode === "atomic" && applied < i + 1) {
      for (let j = i + 1; j < edits.length; j++) lines.push(`edit ${j + 1}: not applied (atomic — the batch is refused).`);
      break;
    }
  }
  return { lines, text, applied };
}

export const pluginEditTool: Tool<Args> = {
  name: "PluginEdit",
  policy: { gated: true, subagent: false },
  description:
    "Makes targeted changes to ONE file of a BytNode-AI plugin you wrote for the user, by replacing exact text fragments — instead of rewriting the whole file with PluginWrite. PluginRead the file first and copy each `old` fragment EXACTLY as it appears. `edits` are each diagnosed on their own and the report lists every one with its outcome. Two modes: `atomic` (all or nothing — one bad edit refuses the batch) or `best-effort` (the good edits apply, the others are reported); default best-effort for a batch of two or more. Causes: not found, appears N times (set `replaceAll: true` to change every occurrence), or old and new are identical (a no-op). A plugin the user already approved goes LIVE when the draft passes the check and asks for no new permission, exactly like PluginWrite. Use PluginWrite for a brand-new file, PluginEdit to change one.",
  parameters: {
    type: "object",
    properties: {
      plugin: PLUGIN_PROP,
      file: { type: "string", description: "plugin.json, server.js, tests.js, or view/<name>.html|css|js" },
      edits: {
        type: "array",
        minItems: 1,
        description: "One or more replacements, applied in order.",
        items: {
          type: "object",
          properties: {
            old: { type: "string", description: "The exact text to replace (copy it from PluginRead)." },
            new: { type: "string", description: "What replaces it. Empty string deletes it." },
            replaceAll: { type: "boolean", description: "Change every occurrence instead of requiring a single one. Default false." },
          },
          required: ["old", "new"],
          additionalProperties: false,
        },
      },
      mode: {
        type: "string",
        enum: ["atomic", "best-effort"],
        description: "How to treat a batch. Default: atomic for one edit, best-effort for two or more.",
      },
    },
    required: ["plugin", "file", "edits"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const p = pluginArg(args.plugin);
    if ("error" in p) return fail(p.error);
    if (!Array.isArray(args.edits) || args.edits.length === 0) return fail("`edits` is required: at least one { old, new }.");
    if (args.mode !== undefined && args.mode !== "atomic" && args.mode !== "best-effort") return fail("`mode` must be \"atomic\" or \"best-effort\".");
    const mode: Mode = args.mode ?? (args.edits.length > 1 ? "best-effort" : "atomic");

    const files = await readFiles(p.id, "draft").catch(() => ({}) as Record<string, string>);
    const before = files[args.file];
    if (before === undefined) return fail(`${p.id} has no file ${args.file} in its draft. Files: ${Object.keys(files).join(", ") || "none"}. Create it with PluginWrite.`);

    const r = run(args.edits, before, mode);
    const head = (): string => (r.applied === args.edits.length ? `Edited ${args.file} of ${p.id} (${r.applied}/${args.edits.length} changes applied).` : `Partially edited ${args.file} of ${p.id} (${r.applied}/${args.edits.length} changes applied; the rest reported below).`);
    const body = () => r.lines.join("\n");

    if (mode === "atomic" && r.applied < args.edits.length) {
      return fail(`Nothing was written (atomic — all or nothing): ${r.applied}/${args.edits.length} would have applied, the batch is refused.\n${body()}`);
    }
    if (r.applied === 0) {
      return fail(`No change written (best-effort — nothing applied).\n${body()}`);
    }

    try {
      await writeDraftFile(p.id, args.file, r.text, ctx.agentId || "an agent");
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }

    if (args.file === "plugin.json") {
      const m = await manifestOf(p.id, await readFiles(p.id, "draft"));
      if (!m.ok) return ok(`${head()}\n${body()}\nplugin.json has problems to fix:\n${m.errors.map((e) => `- ${e}`).join("\n")}`);
    }
    return ok(`${head()}\n${body()} ${await goLive(p.id)}`);
  },
};