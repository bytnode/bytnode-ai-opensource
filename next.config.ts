import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /* Ces paquets embarquent un binaire (ripgrep) ou chargent leurs modules a
     l'execution (pdf-parse, turndown) : le bundler doit les laisser a Node
     tels quels au lieu de tenter de les empaqueter. */
  serverExternalPackages: ["@vscode/ripgrep", "pdf-parse", "turndown", "@joplin/turndown-plugin-gfm", "fast-glob", "@agentclientprotocol/sdk", "@resvg/resvg-js"],
};

export default nextConfig;
