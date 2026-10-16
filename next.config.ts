import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* `npm run dev-zero` runs a second `next dev` beside the usual one: Next
     takes a lock in its build folder, so that one gets its own. */
  distDir: process.env.BYTNODE_AI_DIST_DIR || ".next",
  reactStrictMode: true,
  /* The `next dev` badge goes to the left: the bottom-right corner belongs
     to the meter (context, rate, cost). */
  devIndicators: { position: "bottom-left" },
  experimental: {
    /* ⚠️ With a `proxy.ts`, Next buffers every request body for it and CUTS
       it at this size (10 MB by default): an attachment above ~7.5 MB — its
       base64 in a JSON body — reached `/api/files/upload` truncated and
       failed as "Unreadable request body". The route's own limits (25 MB a
       file, 60 MB a batch, ×4/3 in base64) must fit. `proxy.ts` refuses a
       larger body with a 413: keep its `MAX_BODY` equal to this. */
    proxyClientMaxBodySize: "85mb",
  },
  /* These packages ship a binary (ripgrep, QuickJS's .wasm — the sandbox of
     the plugins agents write) or load their modules at runtime (pdf-parse,
     turndown): the bundler must leave them to Node as they are instead of
     trying to bundle them. */
  serverExternalPackages: ["@vscode/ripgrep", "pdf-parse", "turndown", "@joplin/turndown-plugin-gfm", "fast-glob", "@agentclientprotocol/sdk", "@resvg/resvg-js", "ccxt", "quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],
};

export default nextConfig;
