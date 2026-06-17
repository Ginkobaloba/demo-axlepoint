import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "axle_demo_session";

/**
 * Redirect with a path-relative Location header.
 *
 * We deliberately avoid NextResponse.redirect(new URL(path, request.url)):
 * behind the demo's reverse proxy the origin of request.url is the
 * container's internal bind address (0.0.0.0:3000), so an absolute redirect
 * ships `Location: https://0.0.0.0:3000/app` and the browser follows it to a
 * dead host. A relative Location is resolved by the browser against the
 * address-bar origin (the real public host), which is what we want.
 */
function relativeRedirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * Demo authentication. POST signs in as the demo user and lands on the
 * dashboard; POST with ?signout=1 clears the session and returns to the
 * marketing page. There are no credentials anywhere in this demo.
 */
export async function POST(request: NextRequest) {
  const signout = request.nextUrl.searchParams.get("signout");
  if (signout) {
    const response = relativeRedirect("/");
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const response = relativeRedirect("/app");
  response.cookies.set(SESSION_COOKIE, "demo-user", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return response;
}
