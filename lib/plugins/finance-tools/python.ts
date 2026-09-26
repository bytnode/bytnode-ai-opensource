import path from "node:path";

/* ---------------------------------------------------------------------------
   Which Python to run, by system. Pure: the tests give the platform, the
   PATH lookup and the file checks.

   - Windows: `python`, then the `py` launcher, then `python3`.
   - macOS: Homebrew's and python.org's first. ⚠️ `/usr/bin/python3` is a
     STUB when the Command Line Tools are not installed: running it opens a
     system dialog ("requires the command line developer tools") on the
     user's screen — at every check. It is only tried when the tools exist.
   - Linux: `python3` (plain `python` often does not exist), then `python`.
--------------------------------------------------------------------------- */

type Env = {
  platform: NodeJS.Platform;
  find: (name: string) => string | null;
  exists: (p: string) => boolean;
};

const APPLE_STUB = "/usr/bin/python3";
const APPLE_TOOLS = ["/Library/Developer/CommandLineTools/usr/bin/python3", "/Applications/Xcode.app"];

export function pythonCandidates({ platform, find, exists }: Env): string[] {
  if (platform === "win32") return ["python", "py", "python3"];
  if (platform !== "darwin") return ["python3", "python"];
  const out = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/Library/Frameworks/Python.framework/Versions/Current/bin/python3"].filter(exists);
  const tools = APPLE_TOOLS.some(exists);
  for (const name of ["python3", "python"]) {
    const found = find(name);
    if (!found || out.includes(found)) continue;
    if (path.posix.normalize(found) === APPLE_STUB && !tools) continue;
    out.push(found);
  }
  return out;
}

/** How to install the two modules, in this system's words. */
export function installHint(platform: NodeJS.Platform, python: string): string {
  const cmd = `${python} -m pip install pandas numpy`;
  if (platform === "linux") return `Run \`${cmd}\` — if the system refuses it (externally managed environment), use your distribution's packages (\`sudo apt install python3-pandas python3-numpy\`) or a virtual environment.`;
  return `Run \`${cmd}\`.`;
}
