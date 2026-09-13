import { NextResponse, type NextRequest } from "next/server";
import { crossSiteReason } from "@/lib/server/origin";

/* Devant toutes les routes `/api` : une requete venue d'un autre site est
   refusee avant d'atteindre la route (voir `lib/server/origin.ts`). */
export function proxy(request: NextRequest) {
  const reason = crossSiteReason(request.headers);
  if (reason) return NextResponse.json({ error: { message: `Requête refusée : ${reason}.` } }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
