/* The version `npm publish` will send. npm refuses a version already on the
   registry, forever (even after an unpublish), so `scripts/next-version.ts`
   runs before every publish (prepublishOnly) and moves `package.json` past
   what is published. Pure: the registry's list is passed in. */

type Triple = [number, number, number];

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

const parse = (v: string): Triple | null => {
  const m = STABLE.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

const compare = (a: Triple, b: Triple): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The local version if it is still free and above everything published;
    otherwise the patch after the highest of (local, published). A
    prerelease (`0.1.4-beta.0`) is left alone — it is bumped by hand — and
    refused if it is already taken. */
export function nextVersion(local: string, published: string[]): string {
  const mine = parse(local);
  if (!mine) {
    if (published.includes(local)) throw new Error(`${local} is already published; bump the prerelease (npm version prerelease --no-git-tag-version).`);
    return local;
  }
  const stable = published.map(parse).filter((t): t is Triple => t !== null);
  const highest = stable.reduce<Triple | null>((max, t) => (!max || compare(t, max) > 0 ? t : max), null);
  if (!published.includes(local) && (!highest || compare(mine, highest) > 0)) return local;
  const base = highest && compare(highest, mine) > 0 ? highest : mine;
  return `${base[0]}.${base[1]}.${base[2] + 1}`;
}
