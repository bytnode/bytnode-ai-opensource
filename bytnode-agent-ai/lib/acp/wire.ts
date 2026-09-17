import type { AgentEvent } from "@/lib/agent/events";
import type { PermissionOption } from "@agentclientprotocol/sdk";

/* Ce qui circule du serveur au navigateur pendant un tour ACP : les
   evenements du fil, plus ce qui n'existe qu'ici — l'id de session a
   memoriser, une demande de permission a poser a l'ecran, un appel qui
   precise ses arguments apres coup. Partage navigateur / serveur. */
export type WireEvent =
  | AgentEvent
  | { type: "session"; sessionId: string }
  | { type: "permission"; id: string; title: string; options: PermissionOption[] }
  | { type: "tool_update"; id: string; name?: string; args?: Record<string, unknown>; line?: string };
