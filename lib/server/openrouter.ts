/* Ce que le serveur sait d'OpenRouter : l'adresse, et les en-tetes que le
   service demande pour attribuer le trafic a une application. */

/* Surchargeable par `OPENROUTER_BASE_URL` : un relais local, un serveur de
   test qui rejoue des flux. Lu au demarrage, cote serveur seulement. */
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
  return Response.json({ error: { message: "Aucune clé OpenRouter fournie." } }, { status: 401 });
}
