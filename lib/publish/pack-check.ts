/* What must never go out on npm. `scripts/prepack.ts` runs the archive's
   file list (npm pack --dry-run --json) through here and refuses to
   publish at the first hit. Pure: testable without an archive. */

/* `.next/dev` is the user's running `next dev` (its lock names the pid and
   the port): 0.1.3 shipped it. */
const FORBIDDEN = [/(^|\/)\.env/, /^workspaces\//, /^sandboxes(\/|$)/, /^\.mcp\.json$/, /^scratchpad\//, /^\.next\/dev\//];

/** The patterns of a real key: the prefix alone (`cb_live_` in a message)
    does not count, the body is required. */
const SECRETS = [/cb_(live|test)_[A-Za-z0-9]{8,}/, /sk-or-v1-[A-Za-z0-9]{8,}/];

export const forbiddenPaths = (paths: string[]): string[] => paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));

export const leakedSecrets = (files: { path: string; text: string }[]): string[] =>
  files.filter((f) => SECRETS.some((re) => re.test(f.text))).map((f) => f.path);

/** The files whose text is read to look for a key. */
export const isTextFile = (p: string) => /\.(ts|tsx|js|mjs|cjs|json|md|txt|css|yml|yaml|map)$/.test(p);

/** Every way a build writes the project's absolute path: as is, escaped in
    JSON, with forward slashes (Turbopack's `[project]`), and as a `file:`
    URL (source maps: 0.1.3 shipped `file:///C:/Users/<name>/…`). */
export function machinePathNeedles(root: string): string[] {
  const slash = root.replace(/\\/g, "/");
  const url = `file://${slash.startsWith("/") ? "" : "/"}${slash}`;
  return [...new Set([root, JSON.stringify(root).slice(1, -1), slash, url])];
}

/** The files that contain one of these texts (the build machine's absolute
    path, for instance: it names the user). */
export const containing = (files: { path: string; text: string }[], needles: string[]): string[] =>
  files.filter((f) => needles.some((n) => n.length > 0 && f.text.includes(n))).map((f) => f.path);

/** What the archive must contain, or a subscription agent started from the
    package gets no BytNode-AI tool: the finance MCP server bundled by
    prepack (tsx cannot run the TypeScript source from node_modules —
    `lib/mcp/server-launch.ts`). */
export const REQUIRED = [".next/finance-server.mjs", ".next/BUILD_ID", "bin/bytnode-ai.mjs"];

export const missingPaths = (paths: string[], required: string[] = REQUIRED): string[] => required.filter((r) => !paths.includes(r));
