import type { PluginStatus } from "@/lib/domain/plugins";
import { activePlugins, digestOf, manifestOf, readFiles, readGrant, readLog, readMeta, readRequest, userPluginIds } from "./files";
import { added } from "./permissions";
import type { UserPluginInfo } from "./types";

/* ---------------------------------------------------------------------------
   Where each plugin written by an agent stands, for the browser: its
   state, what runs, what was granted, what waits for the user — with the
   tools the check saw it register, so the review screen names them.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

export async function userPluginInfos(status: PluginStatus[]): Promise<UserPluginInfo[]> {
  const { problems } = await activePlugins();
  const out: UserPluginInfo[] = [];
  for (const id of await userPluginIds()) {
    const [meta, grant, request, draft, active, log] = await Promise.all([
      readMeta(id),
      readGrant(id),
      readRequest(id),
      readFiles(id, "draft").catch(() => ({}) as Record<string, string>),
      readFiles(id, "active").catch(() => ({}) as Record<string, string>),
      readLog(id, 40),
    ]);
    const draftManifest = await manifestOf(id, draft);
    const activeManifest = grant && Object.keys(active).length ? await manifestOf(id, active) : null;
    const manifest = activeManifest?.ok ? activeManifest.value.manifest : draftManifest.ok ? draftManifest.value.manifest : null;
    const run = status.find((s) => s.id === id);
    const problem = problems.find((p) => p.id === id);

    let pending: UserPluginInfo["request"] = null;
    if (request && draftManifest.ok && digestOf(draft) === request.digest) {
      pending = {
        digest: request.digest,
        agentId: request.agentId,
        at: request.at,
        permissions: request.permissions,
        added: added(grant?.permissions ?? null, request.permissions),
        manifest: draftManifest.value.manifest,
        tools: request.tools ?? [],
      };
    }
    const state: UserPluginInfo["state"] = pending ? "pending" : !grant ? "draft" : problem || run?.state === "error" ? "error" : "active";
    out.push({
      id,
      name: manifest?.name ?? id,
      summary: manifest?.summary ?? "",
      state,
      ...(problem ? { message: problem.message } : run?.state === "error" && run.message ? { message: run.message } : {}),
      createdBy: meta?.createdBy ?? "",
      createdAt: meta?.createdAt ?? "",
      updatedBy: meta?.updatedBy ?? "",
      updatedAt: meta?.updatedAt ?? "",
      manifest,
      granted: grant ? { permissions: grant.permissions, accounts: grant.accounts, at: grant.at } : null,
      request: pending,
      log: log.filter((l) => l.level !== "info").slice(-10),
    });
  }
  return out;
}
