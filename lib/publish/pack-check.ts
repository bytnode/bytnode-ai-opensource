/* What must never go out on npm. `scripts/prepack.ts` runs the archive's
   file list (npm pack --dry-run --json) through here and refuses to
   publish at the first hit. Pure: testable without an archive. */

const FORBIDDEN = [/(^|\/)\.env/, /^workspaces\//, /^sandboxes(\/|$)/, /^\.mcp\.json$/, /^scratchpad\//];

/** The patterns of a real key: the prefix alone (`cb_live_` in a message)
    does not count, the body is required. */
const SECRETS = [/cb_(live|test)_[A-Za-z0-9]{8,}/, /sk-or-v1-[A-Za-z0-9]{8,}/];

export const forbiddenPaths = (paths: string[]): string[] => paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));

export const leakedSecrets = (files: { path: string; text: string }[]): string[] =>
  files.filter((f) => SECRETS.some((re) => re.test(f.text))).map((f) => f.path);

/** The files whose text is read to look for a key. */
export const isTextFile = (p: string) => /\.(ts|tsx|js|mjs|cjs|json|md|txt|css|yml|yaml)$/.test(p);

/** The files that contain one of these texts (the build machine's absolute
    path, for instance: it names the user). */
export const containing = (files: { path: string; text: string }[], needles: string[]): string[] =>
  files.filter((f) => needles.some((n) => n.length > 0 && f.text.includes(n))).map((f) => f.path);
