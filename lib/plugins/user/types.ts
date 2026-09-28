import type { PluginManifest } from "@/lib/domain/plugins";
import type { Permissions } from "./permissions";

/* ---------------------------------------------------------------------------
   A plugin written by an agent, as the browser sees it
   (`GET /api/user-plugins`): the library, the review screen, the tabs.
   Pure types, shared.
--------------------------------------------------------------------------- */

export type UserPluginState =
  /** Written, never activated (or its activation was refused). */
  | "draft"
  /** Waiting for the user to review its permissions. */
  | "pending"
  /** Approved and running (or switched off in the library). */
  | "active"
  /** Approved, but it fails to start: see `message`. */
  | "error";

export type UserPluginLog = { at: string; level: "info" | "warn" | "error"; source: string; message: string };

export type UserPluginInfo = {
  id: string;
  name: string;
  summary: string;
  state: UserPluginState;
  message?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  /** The running version's manifest (active), else the draft's when valid. */
  manifest: PluginManifest | null;
  granted: { permissions: Permissions; accounts: string[]; at: string } | null;
  /** Granted before approvals were signed (or signed with another key):
      it does not run until the user approves the SAME grant again. */
  unsigned?: { digest: string };
  /** The activation waiting for the user. */
  request: {
    digest: string;
    agentId: string;
    at: string;
    permissions: Permissions;
    /** What it asks beyond what was granted. */
    added: Permissions;
    manifest: PluginManifest;
    tools: Array<{ name: string; readOnly: boolean }>;
  } | null;
  log: UserPluginLog[];
};
