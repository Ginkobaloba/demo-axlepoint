/**
 * Shared helpers for portal-verify tests (chunk 4b).
 *
 * Generates RSA-2048 key pairs on the fly, exposes their JWKs for a
 * JWKS-shaped fixture, and signs tokens with any chosen key. This keeps
 * tests hermetic: no network calls, no shared keys.
 */

import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export async function makeTestKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
    modulusLength: 2048,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  return { kid, privateKey: privateKey as CryptoKey, publicJwk };
}

export interface SignedClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  customer_id?: string | null;
  role?: "customer" | "staff" | "internal";
  iat?: number;
  exp?: number;
}

/**
 * Sign a token with `key`. Defaults model a typical valid AxlePoint launch
 * token; pass overrides to construct each failure case.
 */
export async function signWith(
  key: TestKey,
  claims: SignedClaims = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = claims.iat ?? now;
  const exp = claims.exp ?? now + 3600;
  return new SignJWT({
    customer_id: claims.customer_id ?? null,
    role: claims.role ?? "customer",
  })
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuedAt(iat)
    .setIssuer(claims.iss ?? "https://portal.projectnexuscode.org")
    .setAudience(claims.aud ?? "axlepoint")
    .setSubject(claims.sub ?? "test.user@example.com")
    .setExpirationTime(exp)
    .sign(key.privateKey);
}

/**
 * Build a fetcher that serves a JWKS containing the given keys. Wraps the
 * payload with the contract's Cache-Control so the verifier's freshness
 * logic exercises real values.
 */
export function makeJwksFetcher(
  keys: TestKey[],
  opts: { cacheControl?: string; status?: number } = {},
): typeof fetch {
  const payload = JSON.stringify({ keys: keys.map((k) => k.publicJwk) });
  const cacheControl =
    opts.cacheControl ?? "public, max-age=3600, stale-while-revalidate=600";
  const status = opts.status ?? 200;
  return (async () =>
    new Response(payload, {
      status,
      headers: {
        "Content-Type": "application/jwk-set+json",
        "Cache-Control": cacheControl,
      },
    })) as unknown as typeof fetch;
}
