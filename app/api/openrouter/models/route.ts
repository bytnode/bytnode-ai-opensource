import { parseOpenRouterModels } from "@/lib/catalog/catalog";
import { OPENROUTER } from "@/lib/server/openrouter";

/* OpenRouter's public catalog, reduced to the useful fields. It requires no
   key. Cached for one hour: the list changes a few times a week, and weighs
   several hundred kilobytes. */
export async function GET() {
  try {
    const res = await fetch(`${OPENROUTER}/models`, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return Response.json({ error: { message: `OpenRouter answered ${res.status}.` } }, { status: 502 });
    }
    const models = parseOpenRouterModels(await res.json());
    return Response.json({ models });
  } catch {
    return Response.json({ error: { message: "OpenRouter is unreachable." } }, { status: 502 });
  }
}
