import { NextResponse, type NextRequest } from "next/server";

export const SESSION_COOKIE = "axle_demo_session";
export const PORTAL_SESSION_COOKIE = "axle_portal_session";

/**
 * The /app surface accepts either:
 *   - the "demo user" cookie set by POST /api/session (no portal involved)
 *   - the portal session cookie set by /api/auth/portal-handoff after a
 *     successful Paradigm Portal JWT handoff (chunk 4b).
 *
 * Either presence is sufficient at the edge; pages do their own deeper
 * read when they need user identity. Keeping both paths live makes the
 * portal rollout additive: existing demo bookmarks still work, but a
 * portal-launched user gets a real authenticated session.
 */
export function middleware(request: NextRequest) {
  const hasDemo = request.cookies.has(SESSION_COOKIE);
  const hasPortal = request.cookies.has(PORTAL_SESSION_COOKIE);
  if (!hasDemo && !hasPortal) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "?signin=required";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/app/:path*",
};
