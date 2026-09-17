import { parseOpenRouterModels } from "@/lib/catalog/catalog";
import { OPENROUTER } from "@/lib/server/openrouter";

/* Le catalogue public d'OpenRouter, reduit aux champs utiles. Il ne demande
   pas de cle. Mis en cache une heure : la liste bouge quelques fois par
   semaine, et pese plusieurs centaines de kilo-octets. */
export async function GET() {
  try {
    const res = await fetch(`${OPENROUTER}/models`, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return Response.json({ error: { message: `OpenRouter a répondu ${res.status}.` } }, { status: 502 });
    }
    const models = parseOpenRouterModels(await res.json());
    return Response.json({ models });
  } catch {
    return Response.json({ error: { message: "OpenRouter est injoignable." } }, { status: 502 });
  }
}
