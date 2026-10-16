/* `npm run dev-zero`: the app on the LIVE code, as a new user gets it, at
   http://localhost:3999 (user requests, 2026-10-12: « dev from zero », from a
   command, on 3999, and EVERYTHING from zero — not only the browser).

   Its own `next dev`, beside the usual one on 3777 (which stays untouched),
   in a session from zero (`fresh-env.ts`):
   - a new data folder (installed agents, plugins, workspaces);
   - an empty home for the server and the agents it starts (Claude, Codex…
     show signed out), the agents on the PATH ignored;
   - a new browser profile (the BytNode account, keys, settings,
     conversations live in its storage): the sign-in page, then the setup.
   Nothing of the real setup is touched — it is only NOT SEEN. Ctrl+C stops
   it; the session lives in the temp folder and goes at the next run.
   Next takes a lock in its build folder: this server builds in `.next-zero`. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { freshEnv, startFresh } from "./fresh-env";

const root = process.cwd();
const PORT = 3999;
const URL_APP = `http://localhost:${PORT}`;

async function main(): Promise<void> {
  const browser = findBrowser();
  if (!browser) throw new Error("no Chrome, Edge or Chromium found — a browser profile from zero needs one of them.");
  if (await listening(PORT)) throw new Error(`port ${PORT} is taken — a dev-zero already runs? Stop it (Ctrl+C in its terminal) and run again.`);

  const s = startFresh(path.join(os.tmpdir(), "bytnode-ai-dev-zero"));
  console.log(`dev-zero: a session from zero in ${s.root}`);
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...freshEnv(s), BYTNODE_AI_DIST_DIR: ".next-zero" },
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.kill("SIGTERM"));

  while (!(await listening(PORT))) await new Promise((r) => setTimeout(r, 500));
  spawn(browser, [`--user-data-dir=${s.profile}`, "--no-first-run", "--no-default-browser-check", "--new-window", URL_APP], { detached: true, stdio: "ignore" }).unref();
  console.log(`dev-zero: ${URL_APP} opened from zero. Ctrl+C stops it.`);
}

function findBrowser(): string | null {
  const env = process.env;
  const candidates =
    process.platform === "win32"
      ? [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]
          .filter((d): d is string => !!d)
          .flatMap((d) => [path.join(d, "Google", "Chrome", "Application", "chrome.exe"), path.join(d, "Microsoft", "Edge", "Application", "msedge.exe")])
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : (env.PATH ?? "").split(":").flatMap((d) => ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"].map((b) => path.join(d, b)));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

main().catch((e: unknown) => {
  console.error(`dev-zero: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
