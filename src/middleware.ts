import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_SESSION_COOKIE, readPortalSession } from "@/lib/portal-session";

export const SESSION_COOKIE = "axle_demo_session";
export { PORTAL_SESSION_COOKIE };

/**
 * The /app surface accepts either:
 *   - the "demo user" cookie set by POST /api/session. This is a bare
 *     marker with no claims to check, by design (D-006: demo auth is a
 *     cookie, not a user system). Its presence alone is sufficient, same
 *     as before this fix; that part of the gate is unchanged.
 *   - a VALID signed portal session cookie set by
 *     /api/auth/portal-handoff after a successful Paradigm Portal JWT
 *     handoff (chunk 4b).
 *
 * Before this fix the portal path was decorative: request.cookies.has()
 * only checked that a cookie named axle_portal_session existed, so any
 * value -- unsigned, forged with another secret, tampered, expired, or
 * alg-none -- opened /app exactly like a real portal session. The real
 * verifier, readPortalSession, had no caller anywhere in the app.
 *
 * Now the portal cookie is verified with jose in the Edge runtime
 * (readPortalSession, portal-session.ts). A missing, invalid, or forged
 * portal cookie is treated exactly as if none were sent, and is cleared
 * on the way out so a forged value does not linger in the browser. Fails
 * closed if AXLE_PORTAL_SESSION_SECRET is missing or under 32 characters:
 * readPortalSession's getSecret() throws in that case, which
 * readPortalSession catches and turns into a verification failure, same
 * as a bad signature.
 *
 * This closes forged portal identity. It does not change the demo
 * cookie path: /app is still reachable with axle_demo_session set to any
 * value, by design (D-006, D-010).
 */
export async function middleware(request: NextRequest) {
  const hasDemo = request.cookies.has(SESSION_COOKIE);
  const portalCookie = request.cookies.get(PORTAL_SESSION_COOKIE)?.value;
  const portalSession = portalCookie
    ? await readPortalSession(portalCookie)
    : null;
  // A portal cookie was sent but did not verify: distinct from no portal
  // cookie at all, because we want to clear it below even if the demo
  // cookie separately grants access.
  const portalCookieBad = portalCookie !== undefined && portalSession === null;

  let response: NextResponse;
  if (hasDemo || portalSession) {
    response = NextResponse.next();
  } else {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "?signin=required";
    response = NextResponse.redirect(url);
  }

  if (portalCookieBad) {
    response.cookies.delete(PORTAL_SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: "/app/:path*",
};
