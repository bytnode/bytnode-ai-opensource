import type { Tool, ToolContext } from "@/lib/tools/types";
import { resolvePolicy } from "@/lib/tools/policy";
import { validateArgs } from "@/lib/tools/validate";
import { CARD_URI } from "@/lib/acp/wire";

/* ---------------------------------------------------------------------------
   One `tools/call` of our MCP server (`finance-server.ts`), end to end:
   arguments checked, the user's confirmation for what always asks, the
   tool run, its result as MCP content. Apart from the stdio transport so
   it can be tested.
--------------------------------------------------------------------------- */

export type ConfirmVerdict = { allowed: true } | { allowed: false; reason: string };

/** Asks BytNode-AI's user to confirm `tool(args)`; null when nobody can be
    asked (a sub-agent's or a background run's server). */
export type Confirm = (tool: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ConfirmVerdict>;

type Content = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "resource"; resource: { uri: string; mimeType: string; text: string } }>;
export type ServedResult = { content: Content; isError: boolean };

const failure = (text: string): ServedResult => ({ content: [{ type: "text", text }], isError: true });

export async function serveCall(tool: Tool, args: Record<string, unknown>, ctx: ToolContext, confirm: Confirm | null): Promise<ServedResult> {
  /* Like the OpenRouter loop: an ill-formed call goes back to the model in
     one sentence, without running. */
  const invalid = validateArgs(tool.parameters, args);
  if (invalid) return failure(`Invalid arguments for ${tool.name}: ${invalid} Fix the call.`);
  /* ⚠️ WHAT COMMITS FUNDS RUNS ONLY ONCE THE USER HAS SAID YES, HERE. The
     agent's own permission prompt is not the guarantee: Codex in « Run
     directly » approves MCP calls by itself, a Claude in « bypass » asks
     nothing. So the server asks BytNode-AI (`/api/acp/confirm`), which asks
     the user in the thread; anything but an explicit yes — a denial, no
     live turn, a timeout, the app unreachable, nobody to ask — and the
     tool does not run. */
  if (resolvePolicy(tool.name, tool.policy).alwaysAsk) {
    const verdict: ConfirmVerdict = confirm
      ? await confirm(tool.name, args, ctx.signal).catch((e: unknown) => ({ allowed: false as const, reason: `The confirmation failed (${e instanceof Error ? e.message : String(e)}): nothing was sent.` }))
      : { allowed: false, reason: "Nobody can confirm it here (a sub-agent or a background run): nothing was sent." };
    if (verdict.allowed !== true) {
      return failure(`${tool.name} was NOT executed: the user must confirm it in BytNode-AI. ${"reason" in verdict ? verdict.reason : ""} Do not retry on your own: tell the user, and ask what to do.`.trim());
    }
  }
  try {
    const result = await tool.execute(args, ctx);
    const content: Content = [{ type: "text", text: result.output }];
    for (const a of result.attachments ?? []) {
      if (a.type !== "image") continue;
      const m = /^data:([^;]+);base64,(.*)$/s.exec(a.dataUrl);
      if (m) content.push({ type: "image", data: m[2], mimeType: m[1] });
    }
    /* The plugin's card for the thread, as a resource the translation
       picks up (`lib/acp/translate.ts`, `cardOf`). */
    if (result.card) {
      content.push({ type: "resource", resource: { uri: CARD_URI, mimeType: "application/json", text: JSON.stringify(result.card) } });
      /* ⚠️ Some agents drop or rewrite a resource block (Claude Code turns
         it into text, or into the resource's own text): the same card on a
         marked line, which the translation finds in any text. */
      content.push({ type: "text", text: `${CARD_URI} ${JSON.stringify(result.card)}` });
    }
    return { content, isError: !result.ok };
  } catch (e) {
    return failure(`The tool failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
