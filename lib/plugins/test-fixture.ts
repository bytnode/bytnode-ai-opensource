import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppNotification, Confirmation, PluginsState } from "@/lib/domain/plugins";
import type { Tool, ToolContext } from "@/lib/tools/types";
import type { ConfirmationRequest, NotificationInput, PluginDefinition, Session } from "./core/contract";
import { PluginRuntime } from "./core/runtime";
import { pluginStore } from "./core/store";

/* The stage set for a plugin's tests: a real runtime on a temporary data
   folder, notifications and confirmations recorded, a session to hand. */

export type Harness = {
  runtime: PluginRuntime;
  root: string;
  notifications: Array<NotificationInput & { plugin: string }>;
  confirmations: Array<ConfirmationRequest & { plugin: string }>;
  session: { current: Session | null };
  tool(name: string): Tool;
  ctx(over?: Partial<ToolContext>): ToolContext;
  close(): Promise<void>;
};

export async function harness(definitions: PluginDefinition[], state: PluginsState = {}, background = false): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-plugin-"));
  const notifications: Harness["notifications"] = [];
  const confirmations: Harness["confirmations"] = [];
  const session: Harness["session"] = { current: null };
  const runtime = new PluginRuntime(definitions, {
    background,
    reservedNames: new Set(),
    store: (id) => pluginStore(id, root),
    notifications: {
      add: async (plugin, n) => {
        notifications.push({ plugin, ...n });
        return { id: `n${notifications.length}`, at: Date.now(), plugin, level: "info", read: false, ...n } as AppNotification;
      },
    },
    confirmations: {
      request: async (plugin, c) => {
        confirmations.push({ plugin, ...c });
        return { id: `c${confirmations.length}`, at: Date.now(), plugin, status: "pending", ...c } as Confirmation;
      },
    },
    session: () => session.current,
    log: () => {},
  });
  await runtime.apply(state);
  return {
    runtime,
    root,
    notifications,
    confirmations,
    session,
    tool(name) {
      const t = runtime.tools(null).find((x) => x.name === name);
      if (!t) throw new Error(`No tool ${name}`);
      return t;
    },
    ctx: (over = {}) => ({
      workspace: root,
      scope: "workspace",
      projectRoot: process.cwd(),
      signal: new AbortController().signal,
      emit: () => {},
      depth: 0,
      llm: { apiKey: "", model: "", effort: null },
      callId: "call",
      ...over,
    }),
    async close() {
      await runtime.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
