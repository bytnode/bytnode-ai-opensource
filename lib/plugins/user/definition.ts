import type { Confirmation } from "@/lib/domain/plugins";
import type { Tool, ToolResult } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { definePlugin, type PluginContext, type PluginDefinition } from "../core/contract";
import { isFrequency } from "../core/frequency";
import { factsCard, tableCard } from "../shared/cards";
import type { SchedulerService } from "../scheduler/service";
import { appendLog, type ActivePlugin, type LogEntry } from "./files";
import { liveOps, type Keys } from "./host-ops";
import { Sandbox, type Limits } from "./sandbox";

/* ---------------------------------------------------------------------------
   A plugin written by an agent, as the runtime sees it: an ordinary
   `PluginDefinition` whose `setup` starts a sandbox and relays what the
   plugin registers there — so it inherits everything the core guarantees
   the shipped ones: a failing setup marks it `error` and nothing else, its
   tool names cannot take a core one or another plugin's, its prompt
   section is bounded, the policy floor applies, and all of it goes when
   it stops (the sandbox too).

   Its tools ask the user in "Ask before acting" mode unless it declares
   them read-only; they reach sub-agents and scheduled runs only when
   read-only and the plugin cannot propose orders.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

const TOOL_NAME = /^[A-Z][A-Za-z0-9]{2,40}$/;
const JOB_ID = /^[a-z][a-z0-9-]{0,40}$/;

export type Registration = Record<string, unknown> & { fn: number };

/** What a plugin's function returned, as a tool's result: a text, or
    `{ text, facts | table }` for a card in the thread, or `{ error }`. */
export function toToolResult(value: unknown): ToolResult {
  if (typeof value === "string") return ok(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.error === "string") return fail(v.error);
    if (typeof v.text === "string") {
      const r = ok(v.text);
      const facts = v.facts as { title?: unknown; rows?: unknown } | undefined;
      const table = v.table as { title?: unknown; columns?: unknown; rows?: unknown } | undefined;
      if (facts && Array.isArray(facts.rows)) {
        const rows = facts.rows.map((row): [string, string] => (Array.isArray(row) ? [String(row[0]), String(row[1])] : [String((row as { label?: unknown }).label), String((row as { value?: unknown }).value)]));
        r.card = factsCard(String(facts.title ?? ""), rows.slice(0, 30));
      } else if (table && Array.isArray(table.columns) && Array.isArray(table.rows)) {
        r.card = tableCard(String(table.title ?? ""), table.columns.map(String), table.rows.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)])));
      }
      return r;
    }
  }
  return ok(JSON.stringify(value ?? null, null, 2));
}

/** Checks one tool's declaration, in the words the agent will read. */
export function readToolDeclaration(a: Record<string, unknown>): { name: string; description: string; parameters: Tool["parameters"]; readOnly: boolean } {
  const name = String(a.name ?? "");
  if (!TOOL_NAME.test(name)) throw new Error(`ctx.tool: "${name}" is not a valid tool name (PascalCase, 3 to 41 letters or digits: DividendCalendar).`);
  const description = typeof a.description === "string" ? a.description.trim() : "";
  if (description.length < 20 || description.length > 1500) throw new Error(`ctx.tool ${name}: \`description\` is required, 20 to 1500 characters — what it does and when to use it, for the agents.`);
  const parameters = (a.parameters ?? { type: "object", properties: {} }) as Tool["parameters"];
  if (typeof parameters !== "object" || parameters === null || parameters.type !== "object" || typeof parameters.properties !== "object" || parameters.properties === null)
    throw new Error(`ctx.tool ${name}: \`parameters\` must be a JSON Schema object: { type: "object", properties: { … }, required: [ … ] }.`);
  return { name, description, parameters, readOnly: a.readOnly === true };
}

/** A confirmation as the plugin sees it: no account id beyond the one it gave. */
const decided = (c: Confirmation) => ({ id: c.id, tool: c.tool, args: c.args, status: c.status, outcome: c.outcome ?? null, payload: c.payload ?? null });

export type DefinitionOptions = {
  /** The keys when no tab is open in this process (the MCP server's). */
  fallbackKeys?: () => Keys | null;
  limits?: Partial<Limits>;
};

export function userPluginDefinition(p: ActivePlugin, opts: DefinitionOptions = {}): PluginDefinition {
  const { manifest, permissions } = p.manifest;
  const grant = { ...p.grant, permissions: p.grant.permissions ?? permissions };
  const log = (source: LogEntry["source"], level: LogEntry["level"], message: string) => void appendLog(p.id, { source, level, message }).catch(() => {});

  return definePlugin({
    manifest,
    async setup(ctx: PluginContext) {
      let sandbox: Sandbox | null = null;
      const box = () => {
        if (!sandbox) throw new Error("The plugin is not running.");
        return sandbox;
      };
      const run = async (fn: number, args: unknown[], what: string, source: LogEntry["source"] = "call", timeoutMs?: number) => {
        try {
          return await box().invoke(fn, args, timeoutMs, what);
        } catch (e) {
          log(source, "error", `${what}: ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      };
      const keys = (): Keys | null => {
        const s = ctx.session();
        if (s) return { bytnodeKey: s.bytnodeKey, accounts: s.exchangeAccounts };
        return opts.fallbackKeys?.() ?? null;
      };
      const scheduler = permissions.schedule ? ctx.optional<SchedulerService>("scheduler") : undefined;

      const register = (op: string, raw: Record<string, unknown> | unknown[]): unknown => {
        if (op === "log") {
          const [level, text] = raw as [LogEntry["level"], string];
          log("log", level === "warn" || level === "error" ? level : "info", String(text));
          return undefined;
        }
        const a = raw as Registration;
        switch (op) {
          case "tool": {
            const d = readToolDeclaration(a);
            const tool: Tool = {
              name: d.name,
              description: d.description,
              parameters: d.parameters,
              policy: { readOnly: d.readOnly, gated: !d.readOnly, subagent: d.readOnly && grant.permissions.exchange !== "orders" },
              async execute(args) {
                try {
                  return toToolResult(await run(a.fn, [args], d.name));
                } catch (e) {
                  return fail(`${d.name} (plugin ${manifest.name}) failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              },
            };
            ctx.tool(tool as Tool<never>);
            return undefined;
          }
          case "action": {
            const name = String(a.name ?? "");
            ctx.api(name, (params) => run(a.fn, [params], `Action ${name}`));
            return undefined;
          }
          case "prompt":
            ctx.prompt(async (target) => {
              const out = await run(a.fn, [{ engine: target.engine, subagent: target.subagent }], "The prompt section");
              return typeof out === "string" ? out : "";
            });
            return undefined;
          case "job": {
            if (!permissions.schedule) throw new Error('ctx.job: this plugin was not granted "schedule": true.');
            const id = String(a.id ?? "");
            const title = typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, 80) : id;
            const every = String(a.every ?? "");
            if (!JOB_ID.test(id)) throw new Error(`ctx.job: "${id}" is not a valid job id (lowercase, digits, dashes).`);
            if (!isFrequency(every)) throw new Error(`ctx.job ${id}: "${every}" is not a frequency. Say "every 5 minutes", "every 2 hours", "daily at 08:00", "every monday at 09:30".`);
            if (!scheduler) {
              if (ctx.background) log("setup", "warn", `The job ${id} does not run: the Scheduler plugin is off.`);
              return undefined;
            }
            scheduler.job({
              id,
              title: `${manifest.name}: ${title}`,
              every,
              catchUp: a.catchUp === "run-once-on-start" ? "run-once-on-start" : "skip",
              run: async ({ reason }) => {
                const out = await run(a.fn, [{ reason }], `Job ${id}`, "job", 5 * 60_000);
                return typeof out === "string" ? out.slice(0, 200) : undefined;
              },
            });
            return undefined;
          }
          case "confirmed":
            ctx.onConfirmed(async (c) => void (await run(a.fn, [decided(c)], "onConfirmed")));
            return undefined;
          default:
            throw new Error(`Unknown registration: ${op}.`);
        }
      };

      const call = liveOps({
        id: p.id,
        grant,
        store: ctx.store,
        keys,
        notify: (n) => ctx.notify(n),
        confirm: (r) => ctx.confirm(r),
        hasView: manifest.views.length > 0,
        invoke: (fnId, args, timeoutMs) => box().invoke(fnId, args, timeoutMs, "ctx.store.update"),
      });

      sandbox = await Sandbox.create({ id: p.id, config: ctx.config(), ops: { call, register }, limits: opts.limits });
      ctx.onDispose(() => sandbox?.dispose());
      try {
        await sandbox.setup(p.files["server.js"] ?? "", "server.js");
      } catch (e) {
        log("setup", "error", e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
  });
}
