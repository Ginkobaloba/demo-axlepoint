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
 */

import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "axle_portal_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h, same order as a workday
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

export async function readPortalSession(
  cookieValue: string | undefined,
): Promise<PortalSessionClaims | null> {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, getSecret(), {
      algorithms: [HS256_ALG],
    });
    if (typeof payload.sub !== "string") return null;
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
