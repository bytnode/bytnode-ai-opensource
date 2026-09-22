import { KEY_HEADER, OPENROUTER, missingKey, openRouterHeaders } from "@/lib/server/openrouter";

/* Checks a key: OpenRouter answers 200 with its label and its credit, 401
   otherwise. */
export async function GET(req: Request) {
  const apiKey = req.headers.get(KEY_HEADER);
  if (!apiKey) return missingKey();

  try {
    const res = await fetch(`${OPENROUTER}/auth/key`, { headers: openRouterHeaders(apiKey), cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      return Response.json({ error: { message: "This key is not recognised by OpenRouter." } }, { status: 401 });
    }
    if (!res.ok) {
      return Response.json({ error: { message: `OpenRouter answered ${res.status}.` } }, { status: 502 });
    }
    const json = (await res.json()) as { data?: { label?: string; limit?: number | null; usage?: number } };
    return Response.json({
      ok: true,
      label: json.data?.label ?? null,
      limit: json.data?.limit ?? null,
      usage: json.data?.usage ?? null,
    });
  } catch {
    return Response.json({ error: { message: "OpenRouter is unreachable." } }, { status: 502 });
  }
}
