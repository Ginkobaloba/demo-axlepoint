/**
 * CA5 rollback-flag coverage. The main suite (portal-verify.test.ts)
 * exercises the default shared engine through the dispatcher; this file pins
 * the PORTAL_VERIFIER=bespoke escape hatch so the rollback path cannot rot
 * silently while it exists. Delete this file together with the flag and
 * portal-verify-bespoke.ts once the shared engine has shipped clean for a
 * release.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import {
  verifyPortalToken,
  _resetPortalVerifyCachesForTests,
  MalformedToken,
  WrongAudience,
  type VerifierConfig,
} from "./portal-verify";
import {
  makeTestKey,
  signWith,
  makeJwksFetcher,
  type TestKey,
} from "./test-helpers/portal-fixtures";

const ISS = "https://portal.projectnexuscode.org";
const AUD = "axlepoint";
const JWKS_URL = `${ISS}/.well-known/jwks.json`;

function configWith(fetcher: typeof fetch): VerifierConfig {
  return {
    jwksUrl: JWKS_URL,
    expectedIssuer: ISS,
    expectedAudience: AUD,
    fetcher,
  };
}

/**
 * Mint a token with no exp claim. The bespoke engine accepts it (jose only
 * validates exp when present); the shared library rejects it. That delta is
 * the sharpest available probe that the flag really switches engines.
 */
async function mintNoExpToken(key: TestKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ customer_id: null, role: "customer" })
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuedAt(now)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setSubject("flag.test@example.com")
    .sign(key.privateKey);
}

describe("PORTAL_VERIFIER=bespoke rollback flag", () => {
  let active: TestKey;

  beforeEach(async () => {
    _resetPortalVerifyCachesForTests();
    active = await makeTestKey("flag-active-1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies a well-formed token through the bespoke engine", async () => {
    vi.stubEnv("PORTAL_VERIFIER", "bespoke");
    const token = await signWith(active, { sub: "flag.test@example.com" });

    const claims = await verifyPortalToken(
      token,
      configWith(makeJwksFetcher([active])),
    );

    expect(claims.sub).toBe("flag.test@example.com");
    expect(claims.role).toBe("customer");
  });

  it("rejects a wrong-audience token through the bespoke engine", async () => {
    vi.stubEnv("PORTAL_VERIFIER", "bespoke");
    const token = await signWith(active, { aud: "harborbistro" });

    await expect(
      verifyPortalToken(token, configWith(makeJwksFetcher([active]))),
    ).rejects.toBeInstanceOf(WrongAudience);
  });

  it("any other flag value routes to the shared engine", async () => {
    vi.stubEnv("PORTAL_VERIFIER", "definitely-not-bespoke");
    const token = await signWith(active);

    const claims = await verifyPortalToken(
      token,
      configWith(makeJwksFetcher([active])),
    );

    expect(claims.sub).toBe("test.user@example.com");
  });

  it("flag flips the actual engine: exp-less token accepted by bespoke only", async () => {
    const token = await mintNoExpToken(active);

    // Default (shared engine): the library requires exp.
    await expect(
      verifyPortalToken(token, configWith(makeJwksFetcher([active]))),
    ).rejects.toBeInstanceOf(MalformedToken);

    // Rollback (bespoke engine): jose validates exp only when present.
    vi.stubEnv("PORTAL_VERIFIER", "bespoke");
    _resetPortalVerifyCachesForTests();
    const claims = await verifyPortalToken(
      token,
      configWith(makeJwksFetcher([active])),
    );
    expect(claims.sub).toBe("flag.test@example.com");
  });
});
