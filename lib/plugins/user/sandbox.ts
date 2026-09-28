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

   Bounds, all enforced here, none trusted to the plugin:
   - MEMORY. Each sandbox has its OWN WebAssembly instance, so its own
     heap, freed with it. ⚠️ QuickJS's `setMemoryLimit` does not count
     long strings (`"x".repeat(1e6)` sailed past 64 MB to 350 MB, and an
     unbounded loop nearly emptied the machine's RAM): the limit that
     holds is the instance's heap, which may not grow past `memoryBytes`
     + `HEAP_OVERHEAD` (`capHeap`) — beyond, the allocation fails and the
     plugin gets "out of memory", in well under a second.
   - CPU. Every entry into the interpreter gets `sliceMs` (an endless loop
     ends as "interrupted", the host stays up), AND every call a
     CUMULATIVE budget of `cpuMs` across all its entries — a plugin that
     busies itself for 1.9 s, awaits a host call, and starts again, used
     to get a fresh slice each time and could hold the server for good.
   - TIME. Every call gets a wall-clock `timeoutMs`.
   A call that runs out of CPU budget or of time, or an entry interrupted
   while its promise was pending, KILLS the sandbox: its pending work is
   dropped, no host call of it lands any more (it kept writing to its
   store after "did not finish within 30 s"), every call waiting on it is
   rejected, and `dead` says why. Its owner starts a fresh one at the next
   call (`definition.ts`).

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

export type Limits = { memoryBytes: number; sliceMs: number; cpuMs: number; timeoutMs: number; setupMs: number };

export const DEFAULT_LIMITS: Limits = { memoryBytes: 64 * 1024 * 1024, sliceMs: 2_000, cpuMs: 5_000, timeoutMs: 30_000, setupMs: 5_000 };

/** What the WebAssembly heap holds besides the plugin's data: the
    interpreter, its stack, the prelude (the instance starts at 16 MB). */
export const HEAP_OVERHEAD = 32 * 1024 * 1024;

let wasm: Promise<QuickJSWASMModule> | null = null;

/** The interpreter's module shared by the syntax checks (nothing runs in
    it), loaded once per process. */
function quickjs(): Promise<QuickJSWASMModule> {
  wasm ??= isolatedModule();
  return wasm;
}

/** A module of its own: a fresh WebAssembly instance, with its own heap. */
async function isolatedModule(): Promise<QuickJSWASMModule> {
  const { newQuickJSWASMModuleFromVariant } = await import("quickjs-emscripten-core");
  const variant = (await import("@jitl/quickjs-wasmfile-release-sync")).default;
  return newQuickJSWASMModuleFromVariant(variant);
}

/* --- The heap cap ------------------------------------------------------------

   Emscripten grows an instance's heap with `WebAssembly.Memory#grow`, from
   inside its allocator; a refused grow makes that allocation fail, which
   QuickJS reports as "out of memory". The Memory object is internal to the
   module, so `grow` is wrapped once for the process: it looks the memory
   up (by the heap's buffer the first time, then by the object) and
   refuses to go past its cap. Any other WebAssembly in the process passes
   straight through. Kept on `globalThis`: a development reload must not
   wrap it twice with maps the other copy cannot see. */

type HeapCaps = { byMemory: WeakMap<WebAssembly.Memory, number>; byBuffer: WeakMap<ArrayBufferLike, number> };
const CAPS_KEY = Symbol.for("bytnode-ai.sandbox.heap-caps");

function heapCaps(): HeapCaps {
  const holder = globalThis as { [CAPS_KEY]?: HeapCaps };
  if (holder[CAPS_KEY]) return holder[CAPS_KEY];
  const caps: HeapCaps = { byMemory: new WeakMap(), byBuffer: new WeakMap() };
  holder[CAPS_KEY] = caps;
  const proto = WebAssembly.Memory.prototype;
  const grow = proto.grow;
  proto.grow = function (this: WebAssembly.Memory, delta: number): number {
    let cap = caps.byMemory.get(this);
    if (cap === undefined) {
      cap = caps.byBuffer.get(this.buffer);
      if (cap !== undefined) caps.byMemory.set(this, cap);
    }
    if (cap !== undefined && this.buffer.byteLength + delta * 65_536 > cap) throw new RangeError("The plugin's memory is full.");
    return grow.call(this, delta);
  };
  return caps;
}

/** Caps the heap of this module's instance; false when the library no
    longer exposes it (the tests catch that). */
export function capHeap(module: QuickJSWASMModule, bytes: number): boolean {
  const heap = (module as unknown as { module?: { HEAP8?: Int8Array } }).module?.HEAP8;
  if (!heap) return false;
  heapCaps().byBuffer.set(heap.buffer, bytes);
  return true;
}

/** The size of this module's heap now. For the tests. */
export const heapSize = (module: QuickJSWASMModule): number => (module as unknown as { module?: { HEAP8?: Int8Array } }).module?.HEAP8?.length ?? 0;

export class SandboxError extends Error {}

export class Sandbox {
  /** The current entry into the interpreter ends here (`sliceMs`). */
  private deadline = Infinity;
  private entryStart = 0;
  /** Interpreter time used by the calls in flight, and what they may use. */
  private spent = 0;
  private budget: number;
  private inFlight = 0;
  private readonly pending = new Set<QuickJSDeferredPromise>();
  private readonly waiting = new Set<(e: Error) => void>();
  private disposed = false;
  private killedBecause: string | null = null;

  private constructor(
    private readonly rt: QuickJSRuntime,
    private readonly vm: QuickJSContext,
    private readonly ops: HostOps,
    readonly limits: Limits,
    /** Its own WebAssembly instance (the heap it may not outgrow). */
    readonly module: QuickJSWASMModule,
  ) {
    this.budget = limits.cpuMs;
  }

  /** Why it was stopped for good, or null while it runs. */
  get dead(): string | null {
    return this.killedBecause ?? (this.disposed ? "The plugin has stopped." : null);
  }

  /** A fresh interpreter with the prelude's `ctx`, the plugin's id and
      configuration. */
  static async create(opts: { id: string; config: Record<string, unknown>; ops: HostOps; limits?: Partial<Limits>; extraPrelude?: string }): Promise<Sandbox> {
    const limits = { ...DEFAULT_LIMITS, ...opts.limits };
    const qjs = await isolatedModule();
    capHeap(qjs, limits.memoryBytes + HEAP_OVERHEAD);
    const rt = qjs.newRuntime();
    rt.setMemoryLimit(limits.memoryBytes);
    rt.setMaxStackSize(512 * 1024);
    const vm = rt.newContext();
    const box = new Sandbox(rt, vm, opts.ops, limits, qjs);
    rt.setInterruptHandler(() => {
      const now = Date.now();
      return box.killedBecause !== null || now > box.deadline || box.spent + (now - box.entryStart) > box.budget;
    });
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
    this.entryStart = Date.now();
    this.deadline = this.entryStart + ms;
  }

  /** Out of the interpreter: the entry's time counts against the budget. */
  private leave(): void {
    this.spent += Date.now() - this.entryStart;
    this.deadline = Infinity;
  }

  private overBudget = () => this.spent > this.budget;

  private budgetMessage = () => `The plugin used more than ${Math.round(this.budget / 1000)} s of processor time for one call and was stopped.`;

  /** Runs the promise jobs queued inside (a resolved host call wakes the
      plugin's `await`). An interruption here leaves a call's promise
      pending forever: the sandbox is stopped, its callers told at once. */
  private pump(): void {
    if (this.disposed) return;
    this.enter();
    const r = this.rt.executePendingJobs();
    this.leave();
    if (!r.error) return;
    this.kill(this.overBudget() ? this.budgetMessage() : this.describe(r.error, true));
  }

  private check(): void {
    if (this.killedBecause) throw new SandboxError(this.killedBecause);
    if (this.disposed) throw new SandboxError("The plugin has stopped.");
  }

  /** Stops it for good: pending work dropped, waiting calls rejected. */
  kill(message: string): void {
    if (this.killedBecause || this.disposed) return;
    this.killedBecause = message;
    for (const reject of this.waiting) reject(new SandboxError(message));
    this.waiting.clear();
    this.dispose();
  }

  private evalGlobal(code: string, filename: string): void {
    this.enter();
    const r = this.vm.evalCode(code, filename, { type: "global" });
    this.leave();
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
    this.spent = 0;
    this.budget = this.limits.setupMs;
    this.enter(this.limits.setupMs);
    const r = this.vm.evalCode(code, filename, { type: "module" });
    this.leave();
    if (r.error) throw new SandboxError(this.describe(r.error, true));
    const exports = await this.settleValue(r.value, this.limits.setupMs, "Loading server.js");
    this.vm.setProp(this.vm.global, "__module", exports);
    exports.dispose();
    await this.callGlobal("__setup", [], this.limits.setupMs, "setup(ctx)", this.limits.setupMs);
  }

  /** Like `settle`, but keeps the value as a handle (a module's exports,
      which QuickJS may hand back as a promise or as the object itself —
      `Promise.resolve` takes both). */
  private async settleValue(handle: QuickJSHandle, timeoutMs: number, what: string): Promise<QuickJSHandle> {
    const native = this.vm.resolvePromise(handle);
    handle.dispose();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped: (e: Error) => void = () => {};
    const killed = new Promise<never>((_, reject) => {
      stopped = reject;
      this.waiting.add(reject);
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        /* ⚠️ Releasing the caller is not enough: the plugin's work would go
           on (writing to its store, using the CPU). It is stopped. */
        const message = `${what} did not finish within ${Math.round(timeoutMs / 1000)} s: the plugin was stopped (it starts again at its next call).`;
        this.kill(message);
        reject(new SandboxError(message));
      }, timeoutMs);
    });
    this.pump();
    try {
      const r = await Promise.race([native, timeout, killed]);
      if (r.error) {
        const message = this.describe(r.error, true);
        /* An interruption turned into the call's rejection: over budget,
           the sandbox stops (its other work would go on otherwise). */
        if (!this.overBudget()) throw new SandboxError(message);
        this.kill(this.budgetMessage());
        throw new SandboxError(this.budgetMessage());
      }
      return r.value;
    } finally {
      clearTimeout(timer);
      this.waiting.delete(stopped);
    }
  }

  /** Calls an async global function of the prelude (`__setup`, `__runTests`).
      `cpuMs`: the processor time it may use in all, across its awaits. */
  async callGlobal(name: string, args: unknown[], timeoutMs = this.limits.timeoutMs, what = name, cpuMs = this.limits.cpuMs): Promise<unknown> {
    this.check();
    /* The budget counts from the first call in flight: overlapping calls
       share it (one plugin, one interpreter). */
    if (this.inFlight === 0) {
      this.spent = 0;
      this.budget = cpuMs;
    }
    this.inFlight++;
    try {
      const fn = this.vm.getProp(this.vm.global, name);
      const handles = args.map((a) => (typeof a === "number" ? this.vm.newNumber(a) : this.vm.newString(typeof a === "string" ? a : JSON.stringify(a))));
      this.enter();
      const r = this.vm.callFunction(fn, this.vm.undefined, ...handles);
      this.leave();
      fn.dispose();
      for (const h of handles) h.dispose();
      if (r.error) {
        const message = this.overBudget() ? this.budgetMessage() : this.describe(r.error, true);
        if (this.overBudget()) this.kill(message);
        throw new SandboxError(message);
      }
      return await this.settle(r.value, timeoutMs, what);
    } finally {
      this.inFlight--;
    }
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
    this.leave();
    if (r.error) throw new SandboxError(this.describe(r.error, true));
    (await this.settleValue(r.value, this.limits.setupMs, `Loading ${filename}`)).dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const reject of this.waiting) reject(new SandboxError(this.killedBecause ?? "The plugin has stopped."));
    this.waiting.clear();
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
