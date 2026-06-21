import { NextResponse, type NextRequest } from "next/server";
import {
  verifyPortalToken,
  verifierConfigFromEnv,
  PortalVerifyError,
  JwksFetchError,
  type VerifierConfig,
} from "@/lib/portal-verify";
import {
  mintPortalSession,
  PORTAL_SESSION_COOKIE,
} from "@/lib/portal-session";

/**
 * Portal handoff (chunk 4b).
 *
 * The Paradigm Portal redirects the user here with a one-shot JWT in the
 * URL fragment (#portal_token=<JWT>). The landing page reads the fragment
 * client-side, scrubs it out of window.location, and POSTs the token to
 * this route. We verify it against the portal's JWKS and, on success, set
 * the app-side `axle_portal_session` cookie. The client then navigates
 * to /app.
 *
 * Status mapping:
 *   200 -> verified, cookie set
 *   400 -> request body missing or malformed
 *   401 -> token failed verification (bad sig, expired, wrong aud, etc.)
 *   503 -> JWKS endpoint unreachable or unparseable. The portal may be
 *          mid-deploy, rate-limited, or returning errors; the client can
 *          retry. Distinct from 401 so monitoring can react.
 *
 * The handler is exported as a function factory so tests can inject a
 * stub VerifierConfig (and therefore a fake JWKS fetcher) without touching
 * environment variables.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function makeHandler(configOverride?: VerifierConfig) {
  return async function handler(
    request: NextRequest,
  ): Promise<NextResponse> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "bad_request", "request body must be JSON");
    }

    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || token.length === 0) {
      return jsonError(400, "bad_request", "missing token in request body");
    }

    const cfg = configOverride ?? verifierConfigFromEnv();
    let claims: Awaited<ReturnType<typeof verifyPortalToken>>;
    try {
      claims = await verifyPortalToken(token, cfg);
    } catch (err) {
      if (err instanceof JwksFetchError) {
        return jsonError(503, "jwks_unavailable", err.message);
      }
      if (err instanceof PortalVerifyError) {
        return jsonError(401, err.code, err.message);
      }
      // Unknown failure. Do not leak internals.
      return jsonError(401, "invalid_token", "token failed verification");
    }

    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      return jsonError(401, "missing_subject", "token has no sub claim");
    }

    const { value, maxAgeSeconds } = await mintPortalSession({
      sub: claims.sub,
      customer_id: claims.customer_id ?? null,
      role: claims.role ?? "customer",
    });

    const response = NextResponse.json(
      {
        ok: true,
        redirect: "/app",
        user: {
          email: claims.sub,
          role: claims.role,
          customer_id: claims.customer_id ?? null,
        },
      },
      { status: 200 },
    );
    response.cookies.set(PORTAL_SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeSeconds,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  };
}

function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export const POST = makeHandler();
