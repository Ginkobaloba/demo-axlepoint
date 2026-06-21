/**
 * Portal token verification (chunk 4b).
 *
 * AxlePoint is a downstream of the Paradigm Portal. The portal mints a
 * short-lived RS256 JWT (60 minute TTL) when a logged-in user clicks the
 * AxlePoint tile, redirects the user here with the token in the URL
 * fragment, and we verify it locally against the portal's published JWKS.
 *
 * Contract: docs/PORTAL_GATE_CONTRACT.md in portal-shell. Headline:
 *
 *   header  { alg: "RS256", kid: "<key id>", typ: "JWT" }
 *   payload { iss: portal origin, aud: "axlepoint", sub: email,
 *             iat, exp, customer_id, role }
 *
 * JWKS endpoint serves active + previous public keys with
 *   Cache-Control: public, max-age=3600, stale-while-revalidate=600
 *
 * This module:
 *
 *   - fetches the JWKS on first call,
 *   - caches it per the response's Cache-Control headers (falling back to
 *     the contract defaults if the headers are missing),
 *   - serves stale while revalidating in the SWR window,
 *   - tries the kid-matching key first, then any remaining key, so a
 *     token minted during a rotation grace window still verifies,
 *   - returns the parsed claims on success or throws a typed error.
 *
 * Errors are typed (PortalVerifyError subclasses) so callers can map them
 * to HTTP status codes precisely.
 */

import {
  jwtVerify,
  importJWK,
  decodeProtectedHeader,
  errors as joseErrors,
  type JWK,
  type JWTPayload,
} from "jose";

// Contract defaults: 1 hour fresh, 10 minutes stale-while-revalidate.
const DEFAULT_MAX_AGE_SECONDS = 3600;
const DEFAULT_SWR_SECONDS = 600;

// Small clock-skew tolerance for iat / exp checks. The portal and the demo
// run on different boxes; a few seconds of drift should not lock a real
// user out.
const CLOCK_SKEW_SECONDS = 30;

/** Shape of a portal-minted access token's claims. */
export interface PortalClaims extends JWTPayload {
  iss: string;
  aud: string | string[];
  sub: string;
  iat: number;
  exp: number;
  customer_id: string | null;
  role: "customer" | "staff" | "internal";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PortalVerifyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PortalVerifyError";
    this.code = code;
  }
}

export class JwksFetchError extends PortalVerifyError {
  constructor(message: string) {
    super("jwks_fetch_failed", message);
    this.name = "JwksFetchError";
  }
}

export class MalformedToken extends PortalVerifyError {
  constructor(message = "token is not a well-formed JWT") {
    super("malformed_token", message);
    this.name = "MalformedToken";
  }
}

export class UnknownKid extends PortalVerifyError {
  constructor(kid: string) {
    super("unknown_kid", `no JWK published for kid=${kid}`);
    this.name = "UnknownKid";
  }
}

export class BadSignature extends PortalVerifyError {
  constructor() {
    super("bad_signature", "signature did not verify against any published key");
    this.name = "BadSignature";
  }
}

export class Expired extends PortalVerifyError {
  constructor() {
    super("expired", "token exp is in the past");
    this.name = "Expired";
  }
}

export class IssuedInFuture extends PortalVerifyError {
  constructor() {
    super("iat_in_future", "token iat is in the future");
    this.name = "IssuedInFuture";
  }
}

export class WrongAudience extends PortalVerifyError {
  constructor(expected: string, got: string | string[] | undefined) {
    super(
      "wrong_audience",
      `aud mismatch: expected ${expected}, got ${JSON.stringify(got)}`,
    );
    this.name = "WrongAudience";
  }
}

export class WrongIssuer extends PortalVerifyError {
  constructor(expected: string, got: string | undefined) {
    super(
      "wrong_issuer",
      `iss mismatch: expected ${expected}, got ${JSON.stringify(got)}`,
    );
    this.name = "WrongIssuer";
  }
}

// ---------------------------------------------------------------------------
// Config + cache
// ---------------------------------------------------------------------------

export interface VerifierConfig {
  jwksUrl: string;
  expectedIssuer: string;
  expectedAudience: string;
  /** Override for tests. */
  fetcher?: typeof fetch;
  /** Override for tests. Returns unix milliseconds. */
  now?: () => number;
}

interface JwksCacheEntry {
  keys: JWK[];
  /** Unix ms at which the fresh window ends. */
  freshUntilMs: number;
  /** Unix ms at which the stale-while-revalidate window ends. */
  staleUntilMs: number;
}

interface CacheStore {
  entry: JwksCacheEntry | null;
  inflight: Promise<JwksCacheEntry> | null;
}

const caches = new Map<string, CacheStore>();

function storeFor(jwksUrl: string): CacheStore {
  let store = caches.get(jwksUrl);
  if (!store) {
    store = { entry: null, inflight: null };
    caches.set(jwksUrl, store);
  }
  return store;
}

/** Test helper. Wipes all caches across all JWKS URLs. */
export function _resetPortalVerifyCachesForTests(): void {
  caches.clear();
}

// ---------------------------------------------------------------------------
// JWKS fetching
// ---------------------------------------------------------------------------

/**
 * Parse Cache-Control into (max-age, stale-while-revalidate). Both default to
 * the contract values if the header is missing or unparseable.
 */
function parseCacheControl(header: string | null): {
  maxAge: number;
  swr: number;
} {
  if (!header) {
    return { maxAge: DEFAULT_MAX_AGE_SECONDS, swr: DEFAULT_SWR_SECONDS };
  }
  let maxAge = DEFAULT_MAX_AGE_SECONDS;
  let swr = DEFAULT_SWR_SECONDS;
  for (const raw of header.split(",")) {
    const part = raw.trim().toLowerCase();
    const m = /^max-age=(\d+)$/.exec(part);
    if (m) maxAge = Number(m[1]);
    const s = /^stale-while-revalidate=(\d+)$/.exec(part);
    if (s) swr = Number(s[1]);
  }
  return { maxAge, swr };
}

async function fetchJwks(cfg: VerifierConfig): Promise<JwksCacheEntry> {
  const f = cfg.fetcher ?? fetch;
  const now = (cfg.now ?? Date.now)();
  let response: Response;
  try {
    response = await f(cfg.jwksUrl, {
      headers: { Accept: "application/jwk-set+json, application/json" },
    });
  } catch (err) {
    throw new JwksFetchError(
      `network error fetching JWKS: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new JwksFetchError(
      `JWKS endpoint returned HTTP ${response.status}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new JwksFetchError(
      `JWKS response was not valid JSON: ${(err as Error).message}`,
    );
  }
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new JwksFetchError("JWKS response had no keys");
  }
  const { maxAge, swr } = parseCacheControl(
    response.headers.get("Cache-Control"),
  );
  return {
    keys: keys as JWK[],
    freshUntilMs: now + maxAge * 1000,
    staleUntilMs: now + (maxAge + swr) * 1000,
  };
}

/**
 * Return a fresh-enough JWKS, fetching if needed. Honors the
 * stale-while-revalidate window: stale entries are returned immediately while
 * a background refresh runs. Past the SWR window, callers wait for a
 * synchronous refresh.
 */
async function getJwks(cfg: VerifierConfig): Promise<JWK[]> {
  const store = storeFor(cfg.jwksUrl);
  const now = (cfg.now ?? Date.now)();

  if (store.entry && now < store.entry.freshUntilMs) {
    return store.entry.keys;
  }

  if (store.entry && now < store.entry.staleUntilMs) {
    // Stale-but-OK. Kick off a background refresh and return what we have.
    if (!store.inflight) {
      store.inflight = fetchJwks(cfg)
        .then((next) => {
          store.entry = next;
          return next;
        })
        .catch((err) => {
          // Swallow background refresh failures; we still have a stale entry.
          // Surface the error on the next cold fetch.
          // eslint-disable-next-line no-console
          console.warn(
            "[portal-verify] background JWKS refresh failed:",
            err.message,
          );
          throw err;
        })
        .finally(() => {
          store.inflight = null;
        });
    }
    return store.entry.keys;
  }

  // Either no entry yet, or past the SWR window. Block on the refresh, but
  // coalesce concurrent calls onto one inflight request.
  if (!store.inflight) {
    store.inflight = fetchJwks(cfg)
      .then((next) => {
        store.entry = next;
        return next;
      })
      .finally(() => {
        store.inflight = null;
      });
  }
  const refreshed = await store.inflight;
  return refreshed.keys;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a JWT minted by the Paradigm Portal. On success, returns the parsed
 * claims. On failure, throws a typed PortalVerifyError subclass.
 *
 * Verification:
 *
 *   1. Fetch (or reuse) the JWKS.
 *   2. Decode the header to find the kid. Try that kid first.
 *   3. If no kid match or the kid-match fails signature, try every other key
 *      so a token minted during the rotation grace window still verifies.
 *   4. Check iss exactly, aud exactly, exp in the future, iat not in the
 *      future (with a small clock-skew tolerance).
 */
export async function verifyPortalToken(
  token: string,
  cfg: VerifierConfig,
): Promise<PortalClaims> {
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new MalformedToken();
  }

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new MalformedToken();
  }
  if (header.alg !== "RS256") {
    throw new MalformedToken(
      `unsupported alg: ${String(header.alg)} (only RS256)`,
    );
  }

  const keys = await getJwks(cfg);
  const kid = typeof header.kid === "string" ? header.kid : null;

  // Order keys: kid match first, then everything else. If the header has a
  // kid but the JWKS has no key with that kid AND no unkid'd keys either,
  // throw UnknownKid rather than trying nothing.
  const ordered: JWK[] = [];
  if (kid) {
    const match = keys.find((k) => k.kid === kid);
    if (match) ordered.push(match);
    for (const k of keys) {
      if (k.kid !== kid) ordered.push(k);
    }
    if (ordered.length === 0) {
      throw new UnknownKid(kid);
    }
  } else {
    ordered.push(...keys);
  }

  let lastError: unknown = null;
  for (const jwk of ordered) {
    try {
      const publicKey = await importJWK(jwk, "RS256");
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: ["RS256"],
        clockTolerance: CLOCK_SKEW_SECONDS,
      });
      return assertAndReturnClaims(payload, cfg);
    } catch (err) {
      lastError = err;
      // Try the next key only if this looked like a signature failure.
      // Any other class of error (expired token, malformed token) will
      // recur the same way against every key, so do not waste verifies.
      if (
        err instanceof joseErrors.JWSSignatureVerificationFailed ||
        err instanceof joseErrors.JWSInvalid
      ) {
        continue;
      }
      break;
    }
  }

  if (lastError instanceof PortalVerifyError) {
    throw lastError;
  }
  if (lastError instanceof joseErrors.JWTExpired) {
    throw new Expired();
  }
  if (lastError instanceof joseErrors.JWTClaimValidationFailed) {
    // Should not happen normally; we apply claim checks ourselves. Map to
    // MalformedToken so callers still see a typed error.
    throw new MalformedToken(lastError.message);
  }
  if (
    lastError instanceof joseErrors.JWSSignatureVerificationFailed ||
    lastError instanceof joseErrors.JWSInvalid ||
    lastError === null
  ) {
    throw new BadSignature();
  }
  throw new MalformedToken((lastError as Error).message);
}

/**
 * Apply contract claim checks (iss, aud, iat-not-in-future). jose already
 * validated `exp` with clock tolerance during `jwtVerify`, so we do not
 * re-check it here; an expired token reaches this function only if the
 * outer catch above translated it for us.
 */
function assertAndReturnClaims(
  payload: JWTPayload,
  cfg: VerifierConfig,
): PortalClaims {
  if (typeof payload.iss !== "string" || payload.iss !== cfg.expectedIssuer) {
    throw new WrongIssuer(cfg.expectedIssuer, payload.iss);
  }

  const aud = payload.aud;
  const audMatch =
    aud === cfg.expectedAudience ||
    (Array.isArray(aud) && aud.includes(cfg.expectedAudience));
  if (!audMatch) {
    throw new WrongAudience(cfg.expectedAudience, aud);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof payload.iat !== "number" ||
    payload.iat - CLOCK_SKEW_SECONDS > nowSeconds
  ) {
    throw new IssuedInFuture();
  }

  return payload as PortalClaims;
}

/**
 * Convenience: build a VerifierConfig from process.env. The handoff route
 * uses this; tests build their own config so they can inject fetcher + now.
 */
export function verifierConfigFromEnv(): VerifierConfig {
  const jwksUrl =
    process.env.PORTAL_JWKS_URL ??
    "https://portal.projectnexuscode.org/.well-known/jwks.json";
  const expectedIssuer =
    process.env.PORTAL_EXPECTED_ISSUER ??
    "https://portal.projectnexuscode.org";
  const expectedAudience = process.env.PORTAL_EXPECTED_AUD ?? "axlepoint";
  return { jwksUrl, expectedIssuer, expectedAudience };
}
