import type { Confirmation } from "@/lib/domain/plugins";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { ToolContext, ToolResult } from "@/lib/tools/types";
import { fail } from "@/lib/tools/types";
import { exchangeTools } from "@/lib/tools/exchange";
import { alwaysAsks } from "@/lib/tools/names";
import { validateArgs } from "@/lib/tools/validate";
import { dataDir } from "@/lib/server/data-dir";
import { PROJECT_ROOT } from "@/lib/server/workspace";

/* ---------------------------------------------------------------------------
   Running a confirmed call — after the user's click, never before.

   The call is the one the plugin parked (read from the server's file, not
   from the browser: what was shown is what runs). The account must be the
   one it named, sent by the browser like any tool request's accounts; the
   tool is the CORE's own (PlaceOrder…), with its checks: precision,
   minimum, hedge mode. Only a tool that always asks can be run here.
--------------------------------------------------------------------------- */

export async function runConfirmed(c: Confirmation, accounts: ExchangeAccount[], signal: AbortSignal): Promise<ToolResult> {
  const account = accounts.find((a) => a.id === c.accountId);
  if (!account) return fail("The exchange account of this order is no longer configured in this browser.");
  const tool = exchangeTools().find((t) => t.name === c.tool);
  if (!tool || !alwaysAsks(tool.name)) return fail(`${c.tool} cannot be run from a confirmation.`);
  const args = { ...c.args, account: account.label };
  const invalid = validateArgs(tool.parameters, args);
  if (invalid) return fail(`Invalid order: ${invalid}`);
  const ctx: ToolContext = {
    workspace: dataDir(),
    scope: "workspace",
    projectRoot: PROJECT_ROOT,
    signal,
    emit: () => {},
    depth: 0,
    llm: { apiKey: "", model: "", effort: null },
    callId: c.id,
    exchangeAccounts: [account],
  };
  return tool.execute(args, ctx);
}
