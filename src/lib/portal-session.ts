/**
 * App-side session minted after a successful portal handoff (chunk 4b).
 *
 * After /api/auth/portal-handoff verifies the portal JWT we set a small
 * HS256-signed cookie carrying the portal sub + role + customer_id +
 * issued-at. The cookie is httpOnly + sameSite=lax + secure-in-prod and
 * scoped to the whole site.
 *
 * We deliberately did NOT reuse the existing `axle_demo_session` cookie:
 * the demo cookie path still works for the no-portal demo flow (Tier 2,
 * additive). The middleware accepts either cookie.
 *
 * HS256 is fine here because both the issuer (this handoff route) and the
 * verifier (this app's middleware / pages) are the same Node process. We
 * are not federating this cookie anywhere.
 *
 * readPortalSession is called from src/middleware.ts, which runs in the
 * Edge runtime. Subpath imports (jose/jwt/sign, jose/jwt/verify) keep the
 * Edge bundle to JWS/JWT only; the jose root entry also pulls in JWE
 * (deflate via CompressionStream), which Next's Edge analyzer flags as
 * unsupported even though it is never called here. Same pattern as
 * lumen-analytics src/lib/portal-session.ts.
 */

import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

const COOKIE_NAME = "axle_portal_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h, same order as a workday
const HS256_ALG = "HS256";

export const PORTAL_SESSION_COOKIE = COOKIE_NAME;

export interface PortalSessionClaims {
  sub: string;
  customer_id: string | null;
  role: "customer" | "staff" | "internal";
}

// Dev-secret fallback removed deliberately as part of Harbor-pattern
// standardization (chunk 4b follow-up). Every deployed environment
// (including local dev) must wire AXLE_PORTAL_SESSION_SECRET explicitly.
// See demo-harborbistro src/lib/portal-session.ts for the canonical pattern.
function getSecret(): Uint8Array {
  const raw = process.env.AXLE_PORTAL_SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "AXLE_PORTAL_SESSION_SECRET must be set to a value of at least 32 characters",
    );
  }
  return new TextEncoder().encode(raw);
}

export async function mintPortalSession(
  claims: PortalSessionClaims,
): Promise<{ value: string; maxAgeSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const value = await new SignJWT({
    customer_id: claims.customer_id,
    role: claims.role,
  })
    .setProtectedHeader({ alg: HS256_ALG, typ: "JWT" })
    .setIssuedAt(now)
    .setSubject(claims.sub.toLowerCase())
    .setExpirationTime(exp)
    .sign(getSecret());
  return { value, maxAgeSeconds: SESSION_TTL_SECONDS };
}

/**
 * Verify a session token. Returns null on any failure, including a token
 * that is validly signed but missing sub, iat, or exp.
 *
 * jose's jwtVerify checks exp/iat/nbf only when the claim is present, so a
 * hand-signed token that simply omits exp would otherwise verify forever.
 * requiredClaims closes that: a session missing sub, iat, or exp is
 * refused outright, even though mintPortalSession never produces one.
 *
 * requiredClaims alone only checks presence, not value. jose validates
 * iat's value against the clock only when maxTokenAge is set, and it never
 * relates exp to iat at all. Without more, a holder of
 * AXLE_PORTAL_SESSION_SECRET could still hand-sign an "accepted" token
 * with exp decades out, iat in the future, iat after exp, or a fractional
 * exp/iat. Two layers close that, mirroring demo-slatewell's
 * admin-session.ts (#38, #39):
 *   - maxTokenAge: SESSION_TTL_SECONDS makes jose itself reject an iat more
 *     than the session TTL in the past, or an iat in the future at all
 *     (zero clock tolerance; mint and verify share a process clock, so no
 *     skew to absorb).
 *   - An explicit check below requires exp - iat to be a positive integer
 *     no greater than SESSION_TTL_SECONDS. maxTokenAge bounds iat against
 *     "now" but never against exp, so it does not by itself stop a token
 *     minted this second with exp set decades out; this check does. It
 *     also rejects a fractional exp or iat, which jose accepts as long as
 *     it is a finite number.
 *
 * No issuer/audience check: mintPortalSession does not set iss/aud, so
 * requiring them here would reject every real session.
 */
export async function readPortalSession(
  cookieValue: string | undefined,
): Promise<PortalSessionClaims | null> {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, getSecret(), {
      algorithms: [HS256_ALG],
      requiredClaims: ["sub", "iat", "exp"],
      maxTokenAge: SESSION_TTL_SECONDS,
    });
    if (typeof payload.sub !== "string") return null;
    const { exp, iat } = payload;
    if (
      typeof exp !== "number" ||
      typeof iat !== "number" ||
      !Number.isInteger(exp) ||
      !Number.isInteger(iat) ||
      exp - iat <= 0 ||
      exp - iat > SESSION_TTL_SECONDS
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      customer_id:
        (payload.customer_id as string | null | undefined) ?? null,
      role:
        (payload.role as PortalSessionClaims["role"] | undefined) ?? "customer",
    };
  } catch {
    return null;
  }
}
