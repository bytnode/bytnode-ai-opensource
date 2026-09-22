import { NextResponse, type NextRequest } from "next/server";
import { crossSiteReason } from "@/lib/server/origin";

/* In front of every `/api` route: a request coming from another site is
   refused before it reaches the route (see `lib/server/origin.ts`). */
export function proxy(request: NextRequest) {
  const reason = crossSiteReason(request.headers);
  if (reason) return NextResponse.json({ error: { message: `Request refused: ${reason}.` } }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
