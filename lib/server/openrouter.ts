/* What the server knows about OpenRouter: the address, and the headers the
   service requires to attribute traffic to an application. */

/* Overridable through `OPENROUTER_BASE_URL`: a local relay, a test server
   that replays streams. Read at startup, server-side only. */
export const OPENROUTER = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

export const KEY_HEADER = "x-openrouter-key";

export function openRouterHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "http://localhost:3777",
    "X-Title": "BytNode-AI",
    "content-type": "application/json",
  };
}

export function missingKey() {
  return Response.json({ error: { message: "No OpenRouter key provided." } }, { status: 401 });
}
