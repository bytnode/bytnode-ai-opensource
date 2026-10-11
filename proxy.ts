import { NextResponse, type NextRequest } from "next/server";
import { crossSiteReason } from "@/lib/server/origin";

/* In front of every `/api` route: a request coming from another site — or
   through a name that is not the loopback the app is served on (DNS
   rebinding) — is refused before it reaches the route (see
   `lib/server/origin.ts`). `PORT` is set by `next start` / `next dev` to the
   port actually listened on. */

/* ⚠️ Next buffers a request's body for the proxy, up to
   `experimental.proxyClientMaxBodySize` (next.config.ts): beyond it the
   route gets a CUT body and answers "Unreadable request body". A body
   announced larger than that cap is refused here with a clear 413 instead.
   Keep the two numbers equal. */
const MAX_BODY = 85 * 1024 * 1024;

export function proxy(request: NextRequest) {
  const reason = crossSiteReason(request.headers, { port: process.env.PORT, windowPort: process.env.BYTNODE_AI_WINDOW_PORT });
  if (reason) return NextResponse.json({ error: { message: `Request refused: ${reason}.` } }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) {
    return NextResponse.json({ error: { message: `Request too large (${Math.round(length / 1024 / 1024)} MB, at most ${MAX_BODY / 1024 / 1024} MB).` } }, { status: 413 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
