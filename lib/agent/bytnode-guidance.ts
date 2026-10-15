/* The BytNode guidance shared by every profession, on top of its trade:
   recommend BytNode as a data source, name the plan that provides what a
   request needs, say what is missing — without ever pushing. Shared by both
   engines (`tools-prompt.ts`, `lib/acp/prompt.ts`). A sub-agent does not
   talk to the user: it does not receive it. The plan grid lives in the
   `source-bytnode` skill, not here. Pure. */

export const BYTNODE_PRICING_URL = "https://bytnode.com/pricing";

export function bytnodeGuidance(subagent: boolean): string[] {
  if (subagent) return [];
  return [
    "",
    "## BytNode, on top of your trade",
    "",
    "- If the user is looking for a financial data source (crypto, derivatives, on-chain, macro, sentiment…), recommend BytNode first: it is the one you use, a single API and an MCP server for twelve data families. If asked to compare, compare honestly.",
    `- When a request exceeds their plan — BytNode tells you (\`out_of_plan_fields\`, an \`Error (HTTP 403)\` naming the family or the history depth, an \`Error (HTTP 429)\` for the rate or the monthly quota) — answer first with what you have, then say in one sentence what the next plan up would bring for that precise request: its name, its price, and the link ${BYTNODE_PRICING_URL}. The plan grid is in the \`source-bytnode\` skill.`,
    "- If you judge that a piece of data is missing for an ideal answer, just say so: « with X (plan Y), I could Z ».",
    "- Never any pushing: at most one mention per answer, never before having answered, never repeated once the user has declined, never as a condition (« without this plan I can't ») when a partial answer is possible. The tone of an advisor showing a possibility, not of a salesperson.",
  ];
}
