import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten-core";
import { PRELUDE } from "./prelude";

/* ---------------------------------------------------------------------------
   Where a plugin written by an agent runs: a QuickJS interpreter compiled
   to WebAssembly, one per plugin.

   ⚠️ THE SANDBOX IS THE GUARANTEE. Inside, there is no `require`, no
   `process`, no `fetch`, no file, no timer — only the `ctx` of the prelude,
   whose every call comes out here as `(op, JSON)` and is answered by the
   HOST OPS the caller gives (`host-ops.ts`), which check the permissions
   the user granted. Nothing of the host crosses in but JSON.

   Bounds: memory (`memoryBytes`), stack, and CPU — every entry into the
   interpreter gets `sliceMs` before it is interrupted (an infinite loop
   ends as "interrupted", the host stays up) — and every call a wall-clock
   `timeoutMs` (a promise that never settles does not hold the caller).

   Pure WebAssembly: installs anywhere `npx` does, no native build.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

export type HostOps = {
  /** A call the plugin awaits (fetch, store, exchange…). Throws → the
      plugin's promise rejects with the message. */
  call(op: string, args: unknown[]): Promise<unknown>;
  /** A registration during setup (tool, action, job…) or a log line.
      Throws → a synchronous exception in the plugin. */
  register(op: string, args: Record<string, unknown> | unknown[]): unknown;
};

export type Limits = { memoryBytes: number; sliceMs: number; timeoutMs: number; setupMs: number };

export const DEFAULT_LIMITS: Limits = { memoryBytes: 64 * 1024 * 1024, sliceMs: 2_000, timeoutMs: 30_000, setupMs: 5_000 };

let wasm: Promise<QuickJSWASMModule> | null = null;

/** The interpreter's module, loaded once per process. */
function quickjs(): Promise<QuickJSWASMModule> {
  wasm ??= (async () => {
    const { newQuickJSWASMModuleFromVariant } = await import("quickjs-emscripten-core");
    const variant = (await import("@jitl/quickjs-wasmfile-release-sync")).default;
    return newQuickJSWASMModuleFromVariant(variant);
  })();
  return wasm;
}

export class SandboxError extends Error {}

export class Sandbox {
  private deadline = Infinity;
  private readonly pending = new Set<QuickJSDeferredPromise>();
  private disposed = false;

  private constructor(
    private readonly rt: QuickJSRuntime,
    private readonly vm: QuickJSContext,
    private readonly ops: HostOps,
    readonly limits: Limits,
  ) {}

  /** A fresh interpreter with the prelude's `ctx`, the plugin's id and
      configuration. */
  static async create(opts: { id: string; config: Record<string, unknown>; ops: HostOps; limits?: Partial<Limits>; extraPrelude?: string }): Promise<Sandbox> {
    const limits = { ...DEFAULT_LIMITS, ...opts.limits };
    const qjs = await quickjs();
    const rt = qjs.newRuntime();
    rt.setMemoryLimit(limits.memoryBytes);
    rt.setMaxStackSize(512 * 1024);
    const vm = rt.newContext();
    const box = new Sandbox(rt, vm, opts.ops, limits);
    rt.setInterruptHandler(() => Date.now() > box.deadline);
    box.install(opts.id, opts.config);
    box.evalGlobal(PRELUDE, "prelude.js");
    if (opts.extraPrelude) box.evalGlobal(opts.extraPrelude, "test-prelude.js");
    return box;
  }

  private install(id: string, config: Record<string, unknown>): void {
    const { vm } = this;
    const idH = vm.newString(id);
    vm.setProp(vm.global, "__ID", idH);
    idH.dispose();
    const configH = vm.newString(JSON.stringify(config));
    vm.setProp(vm.global, "__CONFIG", configH);
    configH.dispose();

    const sync = vm.newFunction("__hostSync", (opH, jsonH) => {
      const op = vm.getString(opH);
      try {
        const out = this.ops.register(op, JSON.parse(vm.getString(jsonH)) as Record<string, unknown>);
        return out === undefined ? vm.undefined : vm.newString(JSON.stringify(out));
      } catch (e) {
        return { error: vm.newError(e instanceof Error ? e.message : String(e)) };
      }
    });
    vm.setProp(vm.global, "__hostSync", sync);
    sync.dispose();

    const async = vm.newFunction("__host", (opH, jsonH) => {
      const op = vm.getString(opH);
      const args = JSON.parse(vm.getString(jsonH)) as unknown[];
      const deferred = vm.newPromise();
      this.pending.add(deferred);
      void deferred.settled.then(() => {
        this.pending.delete(deferred);
        if (!this.disposed) this.pump();
      });
      this.ops.call(op, Array.isArray(args) ? args : []).then(
        (value) => {
          if (this.disposed || !deferred.alive) return;
          const h = value === undefined ? vm.undefined : vm.newString(JSON.stringify(value));
          deferred.resolve(h);
          if (value !== undefined) h.dispose();
        },
        (e: unknown) => {
          if (this.disposed || !deferred.alive) return;
          const err = vm.newError(e instanceof Error ? e.message : String(e));
          deferred.reject(err);
          err.dispose();
        },
      );
      return deferred.handle;
    });
    vm.setProp(vm.global, "__host", async);
    async.dispose();
  }

  private enter(ms = this.limits.sliceMs): void {
    this.deadline = Date.now() + ms;
  }

  /** Runs the promise jobs queued inside (a resolved host call wakes the
      plugin's `await`). */
  private pump(): void {
    this.enter();
    const r = this.rt.executePendingJobs();
    if (r.error) r.error.dispose();
  }

  private check(): void {
    if (this.disposed) throw new SandboxError("The plugin has stopped.");
  }

  private evalGlobal(code: string, filename: string): void {
    this.enter();
    const r = this.vm.evalCode(code, filename, { type: "global" });
    if (r.error) throw new SandboxError(this.describe(r.error, true));
    r.value.dispose();
  }

  /** The error inside, as one message (with its line when there is one). */
  private describe(handle: QuickJSHandle, dispose = false): string {
    const e = this.vm.dump(handle) as { name?: string; message?: string; stack?: string } | string;
    if (dispose) handle.dispose();
    if (typeof e !== "object" || e === null) return String(e);
    if (e.name === "InternalError" && e.message === "interrupted") return "The plugin ran too long without pausing (an endless loop?) and was stopped.";
    if (e.message === "out of memory") return "The plugin ran out of memory.";
    const at = e.stack?.split("\n").map((l) => l.trim()).find((l) => /\.js:\d+/.test(l));
    return `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message ?? String(e)}${at ? ` (${at.replace(/^at\s+/, "")})` : ""}`;
  }

  /** Settles a promise handle from inside, bounded by `timeoutMs`; the
      value comes out as plain data. */
  private async settle(promise: QuickJSHandle, timeoutMs: number, what: string): Promise<unknown> {
    const h = await this.settleValue(promise, timeoutMs, what);
    const value = this.vm.dump(h) as unknown;
    h.dispose();
    return value;
  }

  /** Evaluates the plugin's module and runs its `setup(ctx)`. */
  async setup(code: string, filename = "server.js"): Promise<void> {
    this.check();
    this.enter(this.limits.setupMs);
    const r = this.vm.evalCode(code, filename, { type: "module" });
    if (r.error) throw new SandboxError(this.describe(r.error, true));
    const exports = await this.settleValue(r.value, this.limits.setupMs, "Loading server.js");
    this.vm.setProp(this.vm.global, "__module", exports);
    exports.dispose();
    await this.callGlobal("__setup", [], this.limits.setupMs, "setup(ctx)");
  }

  /** Like `settle`, but keeps the value as a handle (a module's exports,
      which QuickJS may hand back as a promise or as the object itself —
      `Promise.resolve` takes both). */
  private async settleValue(handle: QuickJSHandle, timeoutMs: number, what: string): Promise<QuickJSHandle> {
    const native = this.vm.resolvePromise(handle);
    handle.dispose();
    this.pump();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SandboxError(`${what} did not finish within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
    });
    try {
      const r = await Promise.race([native, timeout]);
      if (r.error) throw new SandboxError(this.describe(r.error, true));
      return r.value;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Calls an async global function of the prelude (`__setup`, `__runTests`). */
  async callGlobal(name: string, args: unknown[], timeoutMs = this.limits.timeoutMs, what = name): Promise<unknown> {
    this.check();
    const fn = this.vm.getProp(this.vm.global, name);
    const handles = args.map((a) => (typeof a === "number" ? this.vm.newNumber(a) : this.vm.newString(typeof a === "string" ? a : JSON.stringify(a))));
    this.enter();
    const r = this.vm.callFunction(fn, this.vm.undefined, ...handles);
    fn.dispose();
    for (const h of handles) h.dispose();
    if (r.error) throw new SandboxError(this.describe(r.error, true));
    return this.settle(r.value, timeoutMs, what);
  }

  /** Calls back one of the plugin's functions (a tool's `run`…). */
  async invoke(fnId: number, args: unknown[], timeoutMs = this.limits.timeoutMs, what = "The plugin"): Promise<unknown> {
    const out = await this.callGlobal("__invoke", [fnId, JSON.stringify(args)], timeoutMs, what);
    return typeof out === "string" ? (JSON.parse(out) as unknown) : out;
  }

  /** Evaluates more module code in the same context (the plugin's tests). */
  async evalModule(code: string, filename: string): Promise<void> {
    this.check();
    this.enter(this.limits.setupMs);
    const r = this.vm.evalCode(code, filename, { type: "module" });
    if (r.error) throw new SandboxError(this.describe(r.error, true));
    (await this.settleValue(r.value, this.limits.setupMs, `Loading ${filename}`)).dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.pending) if (d.alive) d.dispose();
    this.pending.clear();
    try {
      this.vm.dispose();
      this.rt.dispose();
    } catch {
      /* objects still alive inside: the process keeps a few bytes */
    }
  }
}

/** Does this code parse? The message and line of the first error, or null. */
export async function syntaxError(code: string, filename: string, type: "module" | "global"): Promise<string | null> {
  const qjs = await quickjs();
  const rt = qjs.newRuntime();
  const vm = rt.newContext();
  try {
    const r = vm.evalCode(code, filename, { type, compileOnly: true });
    if (!r.error) {
      r.value.dispose();
      return null;
    }
    const e = vm.dump(r.error) as { name?: string; message?: string; stack?: string };
    r.error.dispose();
    const at = e.stack?.split("\n").map((l) => l.trim()).find((l) => /:\d+/.test(l));
    return `${e.name ?? "SyntaxError"}: ${e.message ?? "unreadable"}${at ? ` (${at.replace(/^at\s+/, "")})` : ""}`;
  } finally {
    vm.dispose();
    rt.dispose();
  }
}
