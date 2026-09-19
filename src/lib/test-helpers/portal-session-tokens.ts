/**
 * Test-only portal session token fixtures (fix/real-portal-session).
 *
 * Hand-signs axle_portal_session cookie values directly with jose,
 * bypassing mintPortalSession entirely, so a malformed, forged, or
 * missing-claim token can be produced -- the app's own minting path
 * always sets every claim and so cannot exercise a rejection.
 *
 * TEST_SECRET and OTHER_SECRET are throwaway values that exist only in
 * this file; no real secret is ever read here.
 *
 * Deliberately does not duplicate PR #30 (fix/customer-session-claims,
 * src/lib/portal-session.test.ts): that branch hardens readPortalSession
 * itself (requiredClaims, maxTokenAge, the exp-iat bound) with its own
 * hand-signed matrix. This file only supports proving the middleware gate
 * checks validity, not presence, against main's readPortalSession.
 */

import { SignJWT } from "jose/jwt/sign";
import { PORTAL_SESSION_COOKIE } from "@/lib/portal-session";

export const TEST_SECRET = "test-only-portal-session-secret-0123456789ab";
export const OTHER_SECRET = "attacker-controlled-portal-secret-9876543210";
export const COOKIE = PORTAL_SESSION_COOKIE;

const enc = (s: string) => new TextEncoder().encode(s);
const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

interface ClaimOverrides {
  sub?: string | null;
  customer_id?: string | null;
  role?: string;
  iat?: number | null;
  exp?: number | null;
}

/**
 * Sign a portal-session-shaped JWT with full control over claims and key.
 * Pass `sub: null`, `iat: null`, or `exp: null` to omit that claim
 * entirely (the "missing claims" hostile case); omit the override key to
 * get the default value.
 */
export async function signPortalSession(
  overrides: ClaimOverrides = {},
  opts: { secret?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    customer_id:
      overrides.customer_id === undefined ? null : overrides.customer_id,
    role: overrides.role ?? "customer",
  };
  let builder = new SignJWT(payload).setProtectedHeader({
    alg: "HS256",
    typ: "JWT",
  });
  const sub = overrides.sub === undefined ? "operator@example.com" : overrides.sub;
  if (sub !== null) builder = builder.setSubject(sub);
  const iat = overrides.iat === undefined ? now : overrides.iat;
  if (iat !== null) builder = builder.setIssuedAt(iat);
  const exp = overrides.exp === undefined ? now + 3600 : overrides.exp;
  if (exp !== null) builder = builder.setExpirationTime(exp);
  return builder.sign(enc(opts.secret ?? TEST_SECRET));
}

/** Named hostile cookie values the portal session gate must reject. */
export async function hostilePortalCookies(): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000);
  const valid = await signPortalSession();
  const [h, p, sig] = valid.split(".");
  const tamperedPayload = b64url({
    customer_id: null,
    role: "internal",
    sub: "admin@example.com",
    iat: now,
    exp: now + 3600,
  });
  const nonePayload = b64url({
    customer_id: null,
    role: "customer",
    sub: "operator@example.com",
    iat: now,
    exp: now + 3600,
  });
  return {
    // The old code accepted this by presence alone; nothing signs it.
    "old plain cookie value (pre-fix pass)": "any-value-opens-the-app",
    "empty value": "",
    // Signature segment stripped: header and payload are well-formed, but
    // there is nothing to verify against.
    unsigned: `${h}.${p}.`,
    "forged with another secret": await signPortalSession(
      {},
      { secret: OTHER_SECRET },
    ),
    "tampered payload, original signature": `${h}.${tamperedPayload}.${sig}`,
    expired: await signPortalSession({ iat: now - 7200, exp: now - 3600 }),
    "alg none, no signature": `${b64url({ alg: "none", typ: "JWT" })}.${nonePayload}.`,
    // Missing sub is the one "missing claims" case main's readPortalSession
    // already refuses (the explicit `typeof payload.sub !== "string"`
    // check). A token missing only exp/iat still verifies on main today;
    // PR #30 closes that with requiredClaims + maxTokenAge, out of scope
    // here (see file header).
    "missing sub claim": await signPortalSession({ sub: null }),
  };
}
