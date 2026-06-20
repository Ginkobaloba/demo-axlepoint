/**
 * Integration tests for /api/auth/portal-handoff (chunk 4b).
 *
 * These tests exercise the route handler directly with a NextRequest and
 * inject a stubbed VerifierConfig so the handler talks to an in-memory
 * fake JWKS instead of the real portal. They cover:
 *
 *   - Good token: 200 + Set-Cookie on the portal session cookie
 *   - Missing or non-JSON body: 400
 *   - Bad signature: 401 with code bad_signature
 *   - Expired token: 401 with code expired
 *   - Wrong audience: 401 with code wrong_audience
 *   - JWKS endpoint failure: 503 with code jwks_unavailable
 *
 * The "rate-limited from portal" case maps to 503 because rate limiting
 * surfaces as a non-2xx JWKS response, which the verifier translates to
 * JwksFetchError, which the handler translates to 503. Asserted via a 429
 * fixture from the fake fetcher.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  makeHandler,
} from "./route";
import {
  type VerifierConfig,
  _resetPortalVerifyCachesForTests,
} from "@/lib/portal-verify";
import {
  readPortalSession,
  PORTAL_SESSION_COOKIE,
} from "@/lib/portal-session";
import {
  makeTestKey,
  signWith,
  makeJwksFetcher,
  type TestKey,
} from "@/lib/test-helpers/portal-fixtures";

const ISS = "https://portal.projectnexuscode.org";
const AUD = "axlepoint";
const JWKS_URL = `${ISS}/.well-known/jwks.json`;

function makeRequest(body: unknown, init: { rawBody?: string } = {}) {
  const url = "http://localhost:3000/api/auth/portal-handoff";
  if (typeof init.rawBody === "string") {
    return new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: init.rawBody,
    });
  }
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function configWith(fetcher: typeof fetch): VerifierConfig {
  return {
    jwksUrl: JWKS_URL,
    expectedIssuer: ISS,
    expectedAudience: AUD,
    fetcher,
  };
}

describe("POST /api/auth/portal-handoff", () => {
  let active: TestKey;
  let stranger: TestKey;

  beforeEach(async () => {
    _resetPortalVerifyCachesForTests();
    active = await makeTestKey("ps-active-it-1");
    stranger = await makeTestKey("ps-stranger-it");
  });

  it("accepts a valid token and sets a portal session cookie", async () => {
    const token = await signWith(active, {
      sub: "operator@acme.example",
      customer_id: "cust-123",
      role: "customer",
    });
    const handler = makeHandler(configWith(makeJwksFetcher([active])));
    const res = await handler(makeRequest({ token }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      redirect: string;
      user: { email: string; role: string; customer_id: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.redirect).toBe("/app");
    expect(body.user.email).toBe("operator@acme.example");
    expect(body.user.role).toBe("customer");
    expect(body.user.customer_id).toBe("cust-123");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${PORTAL_SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");

    // Round-trip the cookie through readPortalSession to confirm the
    // signed session is what we think it is.
    const cookieValue = res.cookies.get(PORTAL_SESSION_COOKIE)?.value;
    const session = await readPortalSession(cookieValue);
    expect(session?.sub).toBe("operator@acme.example");
    expect(session?.customer_id).toBe("cust-123");
    expect(session?.role).toBe("customer");
  });

  it("returns 400 for non-JSON body", async () => {
    const handler = makeHandler(configWith(makeJwksFetcher([active])));
    const res = await handler(makeRequest(null, { rawBody: "not-json" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_request");
  });

  it("returns 400 when token is missing from body", async () => {
    const handler = makeHandler(configWith(makeJwksFetcher([active])));
    const res = await handler(makeRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_request");
  });

  it("returns 401 bad_signature for a token signed by an unknown key", async () => {
    const token = await signWith(stranger);
    const handler = makeHandler(configWith(makeJwksFetcher([active])));
    const res = await handler(makeRequest({ token }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_signature");
    expect(res.cookies.get(PORTAL_SESSION_COOKIE)).toBeUndefined();
  });

  it("returns 401 expired for an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = await signWith(active, { iat: past, exp: past + 60 });
    const handler = makeHandler(configWith(makeJwksFetcher([active])));
    const res = await handler(makeRequest({ token }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("expired");
  });

  it("returns 401 wrong_audience when aud does not match", async () => {
    const token = await signWith(active, { aud: "harborbistro" });
    const handler = makeHandler(configWith(makeJwksFetcher([active])));
    const res = await handler(makeRequest({ token }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("wrong_audience");
  });

  it("returns 503 jwks_unavailable when the JWKS endpoint errors", async () => {
    const failingFetcher = (async () =>
      new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const token = await signWith(active);
    const handler = makeHandler(configWith(failingFetcher));
    const res = await handler(makeRequest({ token }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jwks_unavailable");
  });

  it("returns 503 jwks_unavailable when the portal rate-limits the JWKS pull", async () => {
    const rateLimitedFetcher = (async () =>
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
        },
      })) as unknown as typeof fetch;
    const token = await signWith(active);
    const handler = makeHandler(configWith(rateLimitedFetcher));
    const res = await handler(makeRequest({ token }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jwks_unavailable");
  });
});
