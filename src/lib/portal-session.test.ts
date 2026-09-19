import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT } from "jose";
import {
  mintPortalSession,
  readPortalSession,
  PORTAL_SESSION_COOKIE,
  SESSION_TTL_SECONDS as TTL,
} from "./portal-session";

const TEST_SECRET = "a".repeat(48);

/**
 * Hand-sign a token with the repo's own AXLE_PORTAL_SESSION_SECRET,
 * bypassing mintPortalSession entirely, so a malformed or missing claim
 * can be produced. Never routes through the app's own minting path, which
 * always sets every claim and so cannot exercise a rejection.
 */
async function handSign(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({
    customer_id: null,
    role: "customer",
    ...claims,
  } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe("portal-session", () => {
  beforeEach(() => {
    process.env.AXLE_PORTAL_SESSION_SECRET = TEST_SECRET;
  });

  it("mints a verifiable session cookie value with the right subject", async () => {
    const { value, maxAgeSeconds } = await mintPortalSession({
      sub: "Operator@Acme.Example",
      customer_id: "cust-123",
      role: "customer",
    });
    expect(typeof value).toBe("string");
    expect(maxAgeSeconds).toBe(TTL);

    const session = await readPortalSession(value);
    expect(session).not.toBeNull();
    expect(session?.sub).toBe("operator@acme.example");
    expect(session?.customer_id).toBe("cust-123");
    expect(session?.role).toBe("customer");
  });

  it("rejects a cookie value signed with a different secret", async () => {
    const { value } = await mintPortalSession({
      sub: "a@b.com",
      customer_id: null,
      role: "customer",
    });
    process.env.AXLE_PORTAL_SESSION_SECRET = "b".repeat(48);
    expect(await readPortalSession(value)).toBeNull();
  });

  it("rejects junk and undefined", async () => {
    expect(await readPortalSession("")).toBeNull();
    expect(await readPortalSession("not.a.jwt")).toBeNull();
    expect(await readPortalSession(undefined)).toBeNull();
  });

  it("throws if AXLE_PORTAL_SESSION_SECRET is too short", async () => {
    process.env.AXLE_PORTAL_SESSION_SECRET = "short";
    await expect(
      mintPortalSession({ sub: "x@y.z", customer_id: null, role: "customer" }),
    ).rejects.toThrow(/AXLE_PORTAL_SESSION_SECRET/);
  });

  it("cookie name constant is axle_portal_session", () => {
    expect(PORTAL_SESSION_COOKIE).toBe("axle_portal_session");
  });

  // --- hand-signed malformed tokens: requiredClaims + maxTokenAge + the
  // explicit exp-iat bound must refuse every one of these, even though
  // mintPortalSession never produces one. Signed directly with the test
  // secret, never through mintPortalSession, so the test can actually
  // produce a claim shape the app would never mint.
  describe("hand-signed malformed tokens are refused", () => {
    it("missing exp", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({ sub: "a@b.com", iat: now });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("missing iat", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({ sub: "a@b.com", exp: now + 3600 });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("missing sub", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({ iat: now, exp: now + 3600 });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("exp far in the future (100 years, iat now)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now,
        exp: now + 100 * 365 * 24 * 60 * 60,
      });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("iat in the future", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now + 3600,
        exp: now + 3600 + TTL,
      });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("iat after exp", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now + 50,
        exp: now + 10,
      });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("fractional exp", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now,
        exp: now + 3600.5,
      });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("fractional iat (in the past, isolated from the future-iat rejection)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now - 100.5,
        exp: now + 3600,
      });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("lifetime over the TTL (iat now, exp one hour past the 8h TTL)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now,
        exp: now + TTL + 3600,
      });
      expect(await readPortalSession(token)).toBeNull();
    });

    it("positive control: hand-signed with every claim correct is accepted", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now,
        exp: now + TTL,
      });
      const session = await readPortalSession(token);
      expect(session).not.toBeNull();
      expect(session?.sub).toBe("a@b.com");
    });

    it("boundary: exp - iat exactly equal to the TTL is accepted", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now,
        exp: now + TTL,
      });
      expect(await readPortalSession(token)).not.toBeNull();
    });

    it("boundary: exp - iat one second over the TTL is refused", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await handSign({
        sub: "a@b.com",
        iat: now,
        exp: now + TTL + 1,
      });
      expect(await readPortalSession(token)).toBeNull();
    });
  });
});
