import { NextResponse, type NextRequest } from "next/server";

export const SESSION_COOKIE = "axle_demo_session";

/** The /app surface requires the demo session cookie set by /api/session. */
export function middleware(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
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
