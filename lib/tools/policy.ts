import type { DeclaredPolicy, ToolPolicy } from "./types";
import { ALWAYS_ASK, NEVER_BACKGROUND } from "./names";

/* ---------------------------------------------------------------------------
   What a tool may do without the user.

   Each tool declares its policy next to its code (`Tool.policy`); this
   module decides what is missing and applies the core's floor, which no
   declaration can lower:
     - the tools that commit funds (`ALWAYS_ASK`) always ask, have no
       "Always" and are never given to a sub-agent;
     - Workflow and the exchange action tools (`NEVER_BACKGROUND`) never
       reach a sub-agent nor a background run — they have nobody to ask.
   A tool that declares nothing is sensitive: it asks, and stays with the
   main agent.

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

export function resolvePolicy(name: string, declared?: DeclaredPolicy): ToolPolicy {
  const alwaysAsk = declared?.alwaysAsk === true || ALWAYS_ASK.has(name);
  if (alwaysAsk) return { readOnly: false, gated: true, alwaysAsk: true, subagent: false };
  const readOnly = declared?.readOnly === true;
  return {
    readOnly,
    gated: declared?.gated ?? !readOnly,
    alwaysAsk: false,
    subagent: declared?.subagent === true && !NEVER_BACKGROUND.has(name),
  };
}

/** The resolved policy of each tool, by name: what the browser needs to
    decide whether a call waits for the user. */
export const policiesOf = (tools: Array<{ name: string; policy?: DeclaredPolicy }>): Record<string, ToolPolicy> =>
  Object.fromEntries(tools.map((t) => [t.name, resolvePolicy(t.name, t.policy)]));

/** A tool's policy as the browser knows it: from the toolset, otherwise the
    core's floor applied to an unknown tool (sensitive). */
export const policyIn = (policies: Record<string, ToolPolicy> | undefined, name: string): ToolPolicy => policies?.[name] ?? resolvePolicy(name);

/** Does this call wait for the user? Always for what commits funds;
    otherwise only in "ask" mode, for the gated tools. */
export const mustAsk = (policy: ToolPolicy, skip: boolean): boolean => policy.alwaysAsk || (!skip && policy.gated);

/** The policy in plain words, for the plugin library. */
export function describePolicy(p: ToolPolicy): string {
  const what = p.alwaysAsk
    ? "Always confirmed by you, even in direct execution"
    : p.gated
      ? "Asks your permission in \"Ask before acting\" mode"
      : p.readOnly
        ? "Read-only, runs without asking"
        : "Runs without asking";
  return p.subagent ? `${what} · available to sub-agents and scheduled runs` : what;
}
