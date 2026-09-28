import { ALWAYS_ASK } from "@/lib/tools/names";
import { isFrequency } from "../core/frequency";
import { digestOf, manifestOf, readFiles, readGrant, readLog } from "./files";
import { toToolResult, readToolDeclaration } from "./definition";
import { hostAllowed, added, describePermissions, type Permissions } from "./permissions";
import type { UserManifest } from "./manifest";
import { TEST_PRELUDE } from "./prelude";
import { Sandbox, syntaxError } from "./sandbox";
import { viewProblems } from "./view";

/* ---------------------------------------------------------------------------
   PluginCheck: what `typecheck && lint && test` and a browser run are for
   the shipped plugins, done inside the app — the user's machine has no
   TypeScript, no ESLint, no Playwright.

     1. plugin.json   read and checked field by field
     2. server.js     parses (the line of the first error)
     3. setup         runs in a sandbox of its own, against a fake world:
                      what it registers is listed and checked (names,
                      schemas, frequencies), a permission it uses without
                      declaring is named
     4. tests.js      the agent's own tests, with mocks for the network,
                      BytNode, the exchanges; nothing real is reached
     5. view          index.html present, nothing loaded from outside, its
                      scripts parse; what the last opening of the tab
                      reported

   The report is text the agent reads and acts on. SERVER-ONLY.
--------------------------------------------------------------------------- */

export type CheckStep = { name: string; ok: boolean; lines: string[] };

export type Registered = {
  tools: Array<{ name: string; readOnly: boolean; fn: number }>;
  actions: Array<{ name: string; fn: number }>;
  jobs: Array<{ id: string; title: string; every: string; fn: number }>;
  prompts: number[];
  confirmed: number | null;
};

export type CheckReport = {
  id: string;
  ok: boolean;
  steps: CheckStep[];
  digest: string;
  manifest: UserManifest | null;
  registered: Registered | null;
  /** What activation will ask the user beyond what they granted. */
  toApprove: Permissions | null;
};

export type CheckOptions = {
  /** Tool names taken: the core's, and other plugins' (by plugin). */
  taken: Map<string, string>;
};

const ACTION = /^[a-z][a-z0-9-]*$/;

type Mock = { kind: string; key: string; value: unknown };

/** The fake world a check runs against. */
function checkOps(p: Permissions, registered: Registered, mocks: Mock[], record: { notifications: unknown[]; confirmations: Array<Record<string, unknown>> }, box: () => Sandbox) {
  const store = new Map<string, unknown>();
  const lines = new Map<string, unknown[]>();
  const mocked = (kind: string, key: string) => {
    /* The longest matching key; among equal ones, the last set (a test
       changes what the world answers). */
    const list = mocks.filter((m) => m.kind === kind && (m.key === key || (kind === "fetch" && key.startsWith(m.key))));
    return list.reverse().sort((a, b) => b.key.length - a.key.length)[0];
  };
  const refuse = (what: string, how: string) => {
    throw new Error(`Uses ${what} without declaring it: add ${how} to plugin.json → permissions.`);
  };
  const account = () => (mocked("accounts", "")?.value as Array<{ id: string }> | undefined) ?? [{ id: "test-account", label: "Test account", exchange: "binance", testnet: true }];

  return async (op: string, a: unknown[]): Promise<unknown> => {
    switch (op) {
      case "fetch": {
        const url = new URL(String(a[0]));
        if (!hostAllowed(url.hostname, p.network)) refuse(`the host ${url.hostname}`, `"network": ["${url.hostname}"]`);
        const m = mocked("fetch", url.toString());
        if (!m) throw new Error(`No network in a check: mock it in tests.js — mock.fetch("${url.origin}${url.pathname}", { json: … }).`);
        const r = (m.value ?? {}) as { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };
        const status = r.status ?? 200;
        return { status, ok: status >= 200 && status < 300, url: url.toString(), headers: r.headers ?? {}, text: r.text ?? JSON.stringify(r.json ?? null) };
      }
      case "bytnode": {
        if (!p.bytnode) refuse("BytNode", '"bytnode": true');
        const m = mocked("bytnode", String(a[0]));
        if (!m) throw new Error(`No BytNode in a check: mock it in tests.js — mock.bytnode("${String(a[0])}", { … }).`);
        return m.value;
      }
      case "price": {
        if (!p.bytnode && p.exchange === "none") refuse("prices", '"bytnode": true');
        const m = mocked("price", String(a[0]));
        if (!m) throw new Error(`No prices in a check: mock it in tests.js — mock.price("${String(a[0])}", 65000).`);
        return { symbol: a[0], price: m.value, source: "mock", at: new Date().toISOString() };
      }
      case "exchange.accounts":
        if (p.exchange === "none") refuse("the exchange accounts", '"exchange": "read"');
        return account();
      case "exchange.balance":
      case "exchange.positions":
      case "exchange.orders":
      case "exchange.ticker":
      case "exchange.trades":
      case "exchange.read": {
        if (p.exchange === "none") refuse("the exchange accounts", '"exchange": "read"');
        const method = op === "exchange.read" ? String(a[1]) : op.slice("exchange.".length);
        const m = mocked("exchange", method);
        if (!m) throw new Error(`No exchange in a check: mock it in tests.js — mock.exchange("${method}", …).`);
        return m.value;
      }
      case "store.get":
        return store.has(String(a[0])) ? store.get(String(a[0])) : (a[1] ?? null);
      case "store.set":
        store.set(String(a[0]), a[1]);
        return null;
      case "store.update": {
        const name = String(a[0]);
        const next = await box().invoke(Number(a[2]), [store.has(name) ? store.get(name) : (a[1] ?? null)], 10_000, "ctx.store.update");
        store.set(name, next);
        return next;
      }
      case "store.append": {
        const name = String(a[0]);
        lines.set(name, [...(lines.get(name) ?? []), a[1]]);
        return null;
      }
      case "store.lines":
        return lines.get(String(a[0])) ?? [];
      case "notify":
        if (!p.notify) refuse("notifications", '"notify": true');
        record.notifications.push(a[0]);
        return null;
      case "confirm": {
        if (p.exchange !== "orders") refuse("order proposals", '"exchange": "orders"');
        const r = (a[0] ?? {}) as Record<string, unknown>;
        if (!ALWAYS_ASK.has(String(r.tool))) throw new Error(`Only ${[...ALWAYS_ASK].join(", ")} can be proposed to the user.`);
        const c = { id: `c${record.confirmations.length + 1}`, status: "pending", ...r };
        record.confirmations.push(c);
        return { id: c.id, status: "pending" };
      }
      case "sleep":
        return null;
      case "test.resetWorld": {
        /* One test, one world (point 2): a mock or a stored value left by
           the previous test must never leak into the next — a price set in
           test N would silently falsify test N+1. Called before each test. */
        mocks.length = 0;
        store.clear();
        lines.clear();
        record.notifications.length = 0;
        record.confirmations.length = 0;
        return null;
      }
      case "test.tool": {
        const t = registered.tools.find((x) => x.name === a[0]);
        if (!t) throw new Error(`No tool ${String(a[0])}. Registered: ${registered.tools.map((x) => x.name).join(", ") || "none"}.`);
        /* As the agent would get it: a tool that throws answers a failure. */
        try {
          const r = toToolResult(await box().invoke(t.fn, [a[1] ?? {}], undefined, String(a[0])));
          return { ok: r.ok, output: r.output, card: r.card ?? null };
        } catch (e) {
          return { ok: false, output: e instanceof Error ? e.message : String(e), card: null };
        }
      }
      case "test.action": {
        const act = registered.actions.find((x) => x.name === a[0]);
        if (!act) throw new Error(`No action ${String(a[0])}. Registered: ${registered.actions.map((x) => x.name).join(", ") || "none"}.`);
        return box().invoke(act.fn, [a[1] ?? {}], undefined, `Action ${String(a[0])}`);
      }
      case "test.job": {
        const j = registered.jobs.find((x) => x.id === a[0]);
        if (!j) throw new Error(`No job ${String(a[0])}. Registered: ${registered.jobs.map((x) => x.id).join(", ") || "none"}.`);
        return box().invoke(j.fn, [{ reason: "manual" }], undefined, `Job ${String(a[0])}`);
      }
      case "test.prompt": {
        const out: string[] = [];
        for (const fn of registered.prompts) out.push(String((await box().invoke(fn, [{ engine: "native", subagent: false }], undefined, "prompt")) ?? ""));
        return out.join("\n\n");
      }
      case "test.notifications":
        return record.notifications;
      case "test.confirmations":
        return record.confirmations;
      case "test.confirmed": {
        if (registered.confirmed === null) throw new Error("The plugin registered no ctx.onConfirmed.");
        const c = record.confirmations.find((x) => x.id === a[0]);
        if (!c) throw new Error(`No confirmation ${String(a[0])}.`);
        const status = String(a[1] ?? "allowed");
        return box().invoke(registered.confirmed, [{ id: c.id, tool: c.tool, args: c.args, status, outcome: status === "allowed" ? "Order placed (test)." : "Refused (test).", payload: c.payload ?? null }], undefined, "onConfirmed");
      }
      default:
        throw new Error(`Unknown ctx call: ${op}.`);
    }
  };
}

export async function checkUserPlugin(id: string, opts: CheckOptions): Promise<CheckReport> {
  const files = await readFiles(id, "draft");
  const steps: CheckStep[] = [];
  const report: CheckReport = { id, ok: false, steps, digest: digestOf(files), manifest: null, registered: null, toApprove: null };
  if (Object.keys(files).length === 0) {
    steps.push({ name: "files", ok: false, lines: ["The plugin has no files yet: write plugin.json and server.js with PluginWrite."] });
    return report;
  }

  /* 1. plugin.json */
  const m = await manifestOf(id, files);
  if (!m.ok) {
    steps.push({ name: "plugin.json", ok: false, lines: m.errors });
    return report;
  }
  report.manifest = m.value;
  const { manifest, permissions } = m.value;
  const perms = describePermissions(permissions).map((l) => l.text);
  steps.push({ name: "plugin.json", ok: true, lines: [`${manifest.name} ${manifest.version}${manifest.views.length ? ", with a tab" : ", no tab"}`, `Permissions: ${perms.length ? perms.join("; ") : "none"}`] });

  /* 2. server.js */
  const code = files["server.js"];
  if (!code) {
    steps.push({ name: "server.js", ok: false, lines: ["server.js is missing."] });
    return report;
  }
  const syntax = await syntaxError(code, "server.js", "module");
  if (syntax) {
    steps.push({ name: "server.js", ok: false, lines: [syntax] });
    return report;
  }
  steps.push({ name: "server.js", ok: true, lines: ["Parses."] });

  /* 3. setup, against the fake world */
  const registered: Registered = { tools: [], actions: [], jobs: [], prompts: [], confirmed: null };
  const problems: string[] = [];
  const mocks: Mock[] = [];
  const record = { notifications: [] as unknown[], confirmations: [] as Array<Record<string, unknown>> };
  let sandbox: Sandbox | null = null;
  const box = () => {
    if (!sandbox) throw new Error("The check has ended.");
    return sandbox;
  };
  const register = (op: string, raw: Record<string, unknown> | unknown[]): unknown => {
    const a = raw as Record<string, unknown>;
    switch (op) {
      case "log":
        return undefined;
      case "mock":
        mocks.push({ kind: String(a.kind), key: String(a.key), value: a.value });
        return undefined;
      case "tool": {
        const d = readToolDeclaration(a);
        const owner = opts.taken.get(d.name);
        if (owner && owner !== id) throw new Error(`ctx.tool: the name ${d.name} is already taken by ${owner === "core" ? "a core tool" : `the plugin ${owner}`}. Pick another.`);
        if (registered.tools.some((t) => t.name === d.name)) throw new Error(`ctx.tool: ${d.name} is registered twice.`);
        registered.tools.push({ name: d.name, readOnly: d.readOnly, fn: Number(a.fn) });
        return undefined;
      }
      case "action": {
        const name = String(a.name ?? "");
        if (!ACTION.test(name)) throw new Error(`ctx.action: "${name}" is not a valid action name (lowercase letters, digits, dashes).`);
        if (registered.actions.some((x) => x.name === name)) throw new Error(`ctx.action: ${name} is registered twice.`);
        registered.actions.push({ name, fn: Number(a.fn) });
        return undefined;
      }
      case "prompt":
        registered.prompts.push(Number(a.fn));
        return undefined;
      case "job": {
        if (!permissions.schedule) throw new Error('ctx.job needs "schedule": true in plugin.json → permissions.');
        const jid = String(a.id ?? "");
        const every = String(a.every ?? "");
        if (!/^[a-z][a-z0-9-]{0,40}$/.test(jid)) throw new Error(`ctx.job: "${jid}" is not a valid job id (lowercase, digits, dashes).`);
        if (!isFrequency(every)) throw new Error(`ctx.job ${jid}: "${every}" is not a frequency. Say "every 5 minutes", "every 2 hours", "daily at 08:00", "every monday at 09:30".`);
        registered.jobs.push({ id: jid, title: String(a.title ?? jid), every, fn: Number(a.fn) });
        return undefined;
      }
      case "confirmed":
        registered.confirmed = Number(a.fn);
        return undefined;
      default:
        throw new Error(`Unknown registration: ${op}.`);
    }
  };
  const config = Object.fromEntries(Object.entries(manifest.config.properties).map(([k, p]) => [k, p.default]));
  try {
    sandbox = await Sandbox.create({ id, config, ops: { call: checkOps(permissions, registered, mocks, record, box), register }, extraPrelude: TEST_PRELUDE });
    try {
      await sandbox.setup(code, "server.js");
    } catch (e) {
      steps.push({ name: "setup", ok: false, lines: [e instanceof Error ? e.message : String(e), "setup(ctx) should only REGISTER (ctx.tool, ctx.action, ctx.job, ctx.prompt): read data inside the handlers, not during setup."] });
      return report;
    }
    report.registered = registered;
    if (!registered.tools.length && !registered.actions.length && !registered.jobs.length && !registered.prompts.length) problems.push("It registers nothing: no tool, no action, no job, no prompt section.");
    if (manifest.views.length && !registered.actions.length) problems.push("It has a tab but no ctx.action: the page has nothing to call (bn.call).");
    const summary = [
      registered.tools.length ? `Tools: ${registered.tools.map((t) => `${t.name}${t.readOnly ? " (read-only)" : " (asks the user)"}`).join(", ")}` : "",
      registered.actions.length ? `Actions: ${registered.actions.map((x) => x.name).join(", ")}` : "",
      registered.jobs.length ? `Jobs: ${registered.jobs.map((j) => `${j.id} (${j.every})`).join(", ")}` : "",
      registered.prompts.length ? "A prompt section" : "",
    ].filter(Boolean);
    steps.push({ name: "setup", ok: problems.length === 0, lines: [...summary, ...problems] });
    if (problems.length) return report;

    /* 4. tests.js */
    const tests = files["tests.js"];
    if (!tests) {
      steps.push({ name: "tests.js", ok: false, lines: ["tests.js is missing: write at least one test per tool and action (test(\"…\", async () => { … }))."] });
    } else {
      const bad = await syntaxError(tests, "tests.js", "module");
      if (bad) steps.push({ name: "tests.js", ok: false, lines: [bad] });
      else {
        try {
          await sandbox.evalModule(tests, "tests.js");
          const results = (await sandbox.callGlobal("__runTests", [], 120_000, "The tests", 60_000)) as Array<{ name: string; ok: boolean; error?: string }>;
          const failed = results.filter((r) => !r.ok);
          if (!results.length) steps.push({ name: "tests.js", ok: false, lines: ["tests.js declares no test: test(\"…\", async () => { … })."] });
          else
            steps.push({
              name: "tests.js",
              ok: failed.length === 0,
              lines: [`${results.length - failed.length}/${results.length} passed`, ...results.map((r) => (r.ok ? `✓ ${r.name}` : `✗ ${r.name} — ${r.error}`))],
            });
        } catch (e) {
          steps.push({ name: "tests.js", ok: false, lines: [e instanceof Error ? e.message : String(e)] });
        }
      }
    }
  } finally {
    sandbox?.dispose();
    sandbox = null;
  }

  /* 5. view */
  const viewFiles = Object.keys(files).filter((f) => f.startsWith("view/"));
  if (manifest.views.length || viewFiles.length) {
    const lines: string[] = [];
    const errors = await viewProblems(files, manifest.views.length > 0);
    const recent = (await readLog(id, 50)).filter((l) => l.source === "view").slice(-5);
    if (recent.length) lines.push(`The last openings of the tab reported: ${recent.map((l) => l.message).join(" | ")}`);
    steps.push({ name: "view", ok: errors.errors.length === 0, lines: [...(errors.errors.length ? errors.errors : [`${viewFiles.length} file${viewFiles.length > 1 ? "s" : ""}, nothing loaded from outside, scripts parse.`]), ...errors.notes, ...lines] });
  }

  const grant = await readGrant(id);
  report.toApprove = added(grant?.permissions ?? null, permissions);
  report.ok = steps.every((s) => s.ok);
  return report;
}

/** The report as the agent reads it. */
export function reportText(r: CheckReport): string {
  const passed = r.steps.filter((s) => s.ok).length;
  const out = [`PluginCheck ${r.id}: ${r.ok ? "everything passed" : `${passed}/${r.steps.length} steps passed`}`];
  for (const s of r.steps) {
    out.push(`${s.ok ? "✓" : "✗"} ${s.name}`);
    for (const l of s.lines) out.push(`    ${l}`);
  }
  if (r.ok) {
    const asks = r.toApprove ? describePermissions(r.toApprove).map((l) => l.text) : [];
    out.push(asks.length ? `Next: PluginActivate. The user will be asked to grant: ${asks.join("; ")}.` : "Next: PluginActivate. It asks for nothing beyond what the user already granted: it runs at once.");
  } else out.push("Fix what failed (PluginWrite), then run PluginCheck again.");
  return out.join("\n");
}
