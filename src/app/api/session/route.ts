import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "axle_demo_session";

/**
 * Demo authentication. POST signs in as the demo user and lands on the
 * dashboard; POST with ?signout=1 clears the session and returns to the
 * marketing page. There are no credentials anywhere in this demo.
 */
export async function POST(request: NextRequest) {
  const signout = request.nextUrl.searchParams.get("signout");
  if (signout) {
    const response = NextResponse.redirect(new URL("/", request.url), 303);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const response = NextResponse.redirect(new URL("/app", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "demo-user", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return response;
}
