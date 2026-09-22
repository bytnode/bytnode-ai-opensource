import type { AgentEvent } from "@/lib/agent/events";
import type { PermissionOption } from "@agentclientprotocol/sdk";

/* What travels from the server to the browser during an ACP turn: the
   thread's events, plus what only exists here — the session id to
   remember, a permission request to show on screen, a call that refines
   its arguments after the fact. Shared browser / server. */
export type WireEvent =
  | AgentEvent
  | { type: "session"; sessionId: string }
  | { type: "permission"; id: string; title: string; options: PermissionOption[] }
  | { type: "tool_update"; id: string; name?: string; args?: Record<string, unknown>; line?: string };
