/**
 * Tests for the /app gate (fix/real-portal-session).
 *
 * Before this fix the portal cookie path was decorative: middleware.ts
 * checked request.cookies.has(PORTAL_SESSION_COOKIE), presence only, with
 * no signature or claim check, so any cookie value opened /app.
 * readPortalSession (the real verifier) had no production caller. These
 * tests pin the fix: the portal cookie is verified with jose, and a
 * missing/invalid/forged value is treated exactly as if none were sent,
 * and is cleared on the way out.
 *
 * The demo cookie path (axle_demo_session) is untouched by this fix: it
 * is presence-only by design (D-006, D-010, D-015). This file includes an
 * explicit test pinning that so it stays visibly considered, not missed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware, SESSION_COOKIE, PORTAL_SESSION_COOKIE } from "@/middleware";
import { mintPortalSession, readPortalSession } from "@/lib/portal-session";
import {
  TEST_SECRET,
  hostilePortalCookies,
  signPortalSession,
} from "@/lib/test-helpers/portal-session-tokens";

function appRequest(cookies: Record<string, string | undefined>): NextRequest {
  const headers = new Headers();
  const pairs = Object.entries(cookies).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  if (pairs.length > 0) {
    headers.set(
      "cookie",
      pairs.map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  return new NextRequest("http://0.0.0.0:3000/app/work-orders", { headers });
}

function isPassThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

function isSigninRedirect(res: Response): boolean {
  const location = res.headers.get("location") ?? "";
  return res.status === 307 && location.includes("/?signin=required");
}

function clearsPortalCookie(res: Response): boolean {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return (
    setCookie.includes(`${PORTAL_SESSION_COOKIE}=;`) &&
    /path=\//i.test(setCookie)
  );
}

beforeEach(() => {
  process.env.AXLE_PORTAL_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  delete process.env.AXLE_PORTAL_SESSION_SECRET;
});

describe("middleware on /app/*", () => {
  it("redirects when no cookie at all is sent", async () => {
    const res = await middleware(appRequest({}));
    expect(isSigninRedirect(res)).toBe(true);
    expect(isPassThrough(res)).toBe(false);
  });

  it("passes with the demo cookie set to any value (by design, D-006/D-010)", async () => {
    const res = await middleware(
      appRequest({ [SESSION_COOKIE]: "demo-user" }),
    );
    expect(isPassThrough(res)).toBe(true);

    const res2 = await middleware(
      appRequest({ [SESSION_COOKIE]: "literally-anything" }),
    );
    expect(isPassThrough(res2)).toBe(true);
  });

  it("passes a hand-signed, validly-signed portal session", async () => {
    const token = await signPortalSession();
    const res = await middleware(
      appRequest({ [PORTAL_SESSION_COOKIE]: token }),
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes a portal session minted the real way (mintPortalSession), proving real portal users are not locked out", async () => {
    const { value } = await mintPortalSession({
      sub: "customer.user@example.com",
      customer_id: "cust-9",
      role: "customer",
    });
    const res = await middleware(
      appRequest({ [PORTAL_SESSION_COOKIE]: value }),
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("rejects every hostile portal cookie value, redirects, and clears the cookie", async () => {
    const cases = await hostilePortalCookies();
    for (const [name, value] of Object.entries(cases)) {
      const res = await middleware(
        appRequest({ [PORTAL_SESSION_COOKIE]: value }),
      );
      expect(isSigninRedirect(res), name).toBe(true);
      expect(isPassThrough(res), name).toBe(false);
      expect(clearsPortalCookie(res), name).toBe(true);
    }
  });

  it("with a bad portal cookie AND a valid demo cookie, still passes (demo path) but clears the bad portal cookie", async () => {
    const cases = await hostilePortalCookies();
    const badPortal = cases["tampered payload, original signature"];
    const res = await middleware(
      appRequest({
        [SESSION_COOKIE]: "demo-user",
        [PORTAL_SESSION_COOKIE]: badPortal,
      }),
    );
    expect(isPassThrough(res)).toBe(true);
    expect(clearsPortalCookie(res)).toBe(true);
  });

  it("with a valid portal cookie and no demo cookie, passes and does not touch the portal cookie", async () => {
    const token = await signPortalSession();
    const res = await middleware(
      appRequest({ [PORTAL_SESSION_COOKIE]: token }),
    );
    expect(isPassThrough(res)).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed when AXLE_PORTAL_SESSION_SECRET is missing, even for a well-formed token", async () => {
    const token = await signPortalSession();
    delete process.env.AXLE_PORTAL_SESSION_SECRET;
    const res = await middleware(
      appRequest({ [PORTAL_SESSION_COOKIE]: token }),
    );
    expect(isSigninRedirect(res)).toBe(true);
    expect(isPassThrough(res)).toBe(false);
  });

  it("fails closed when AXLE_PORTAL_SESSION_SECRET is under 32 characters, even for a token signed with that short secret", async () => {
    const short = "only-31-characters-long-secret";
    expect(short.length).toBeLessThan(32);
    process.env.AXLE_PORTAL_SESSION_SECRET = short;
    const token = await signPortalSession({}, { secret: short });
    const res = await middleware(
      appRequest({ [PORTAL_SESSION_COOKIE]: token }),
    );
    expect(isSigninRedirect(res)).toBe(true);
  });
});

describe("readPortalSession sanity (used directly, not through the middleware)", () => {
  it("round-trips a mintPortalSession value", async () => {
    const { value } = await mintPortalSession({
      sub: "Operator@Example.com",
      customer_id: null,
      role: "staff",
    });
    const session = await readPortalSession(value);
    expect(session?.sub).toBe("operator@example.com");
    expect(session?.role).toBe("staff");
  });
});
