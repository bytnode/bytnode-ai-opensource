import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /* The `next dev` badge goes to the left: the bottom-right corner belongs
     to the meter (context, rate, cost). */
  devIndicators: { position: "bottom-left" },
  /* These packages ship a binary (ripgrep) or load their modules at runtime
     (pdf-parse, turndown): the bundler must leave them to Node as they are
     instead of trying to bundle them. */
  serverExternalPackages: ["@vscode/ripgrep", "pdf-parse", "turndown", "@joplin/turndown-plugin-gfm", "fast-glob", "@agentclientprotocol/sdk", "@resvg/resvg-js", "ccxt"],
};

export default nextConfig;
