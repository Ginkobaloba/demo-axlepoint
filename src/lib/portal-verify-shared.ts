/**
 * Shared-library portal verifier (CA5 cutover).
 *
 * Delegates JWT verification (structural parse, RS256 algorithm gate, kid
 * resolution, signature, exp/nbf, iss, aud) to @paradigm-codes/auth -- the K4
 * client library every Paradigm consumer standardizes on -- and maps its
 * structured AuthError codes back onto this app's typed PortalVerifyError
 * subclasses, so the handoff handler's 401-vs-503 mapping and the existing
 * test matrix are untouched.
 *
 * Behavioral deltas vs the bespoke engine (all safe against the portal
 * contract, which always mints kid + exp):
 *
 *   - a token without a `kid` header is rejected (MalformedToken); the
 *     bespoke engine tried every published key
 *   - a token without `exp` is rejected (MalformedToken); the bespoke engine
 *     accepted it if otherwise valid
 *   - a token whose kid is absent from the JWKS short-circuits at kid lookup
 *     (after the library's one rotation refetch) instead of failing every
 *     key; both engines surface it as BadSignature
 *   - production JWKS caching no longer honors Cache-Control; the library
 *     caches for a fixed TTL (clamped to 60 minutes, which equals the
 *     contract's max-age=3600) and refetches once on an unknown kid, which
 *     picks up a rotation faster than waiting out the bespoke freshness
 *     window did
 *
 * Test-injected configs (a `fetcher` and/or `now` override) instead route
 * through a Cache-Control-honoring JWKS document cache (ported from the
 * bespoke fetch layer) feeding a fresh per-call library cache, so the
 * hermetic test matrix -- including its cache-reuse and
 * stale-while-revalidate cases -- runs unchanged against this engine.
 */

import {
  AuthError,
  InMemoryJwksCache,
  MAX_TTL_MS,
  verifyToken,
  type Jwk,
  type JwtClaims,
} from "@paradigm-codes/auth";
import {
  BadSignature,
  Expired,
  IssuedInFuture,
  JwksFetchError,
  MalformedToken,
  PortalVerifyError,
  WrongAudience,
  WrongIssuer,
  type PortalClaims,
  type VerifierConfig,
} from "./portal-verify-bespoke";

// Mirror the bespoke engine's tolerances and contract defaults exactly.
const CLOCK_SKEW_SECONDS = 30;
const DEFAULT_MAX_AGE_SECONDS = 3600;
const DEFAULT_SWR_SECONDS = 600;

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/** Production path: one library cache per JWKS URL, fixed TTL. */
const sharedCaches = new Map<string, InMemoryJwksCache>();

interface JwksDocEntry {
  keys: Jwk[];
  /** Unix ms at which the fresh window ends. */
  freshUntilMs: number;
  /** Unix ms at which the stale-while-revalidate window ends. */
  staleUntilMs: number;
}

interface DocStore {
  entry: JwksDocEntry | null;
  inflight: Promise<JwksDocEntry> | null;
}

/** Override path: Cache-Control-honoring document cache, per JWKS URL. */
const docCaches = new Map<string, DocStore>();

function docStoreFor(jwksUrl: string): DocStore {
  let store = docCaches.get(jwksUrl);
  if (!store) {
    store = { entry: null, inflight: null };
    docCaches.set(jwksUrl, store);
  }
  return store;
}

/** Test helper. Wipes this engine's caches across all JWKS URLs. */
export function _resetSharedPortalVerifyCachesForTests(): void {
  sharedCaches.clear();
  docCaches.clear();
}

// ---------------------------------------------------------------------------
// JWKS fetching (port of the bespoke fetch layer, typed errors preserved)
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

async function fetchJwksDoc(
  url: string,
  f: typeof fetch,
  now: () => number,
): Promise<JwksDocEntry> {
  const fetchedAt = now();
  let response: Response;
  try {
    response = await f(url, {
      headers: { Accept: "application/jwk-set+json, application/json" },
    });
  } catch (err) {
    throw new JwksFetchError(
      `network error fetching JWKS: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new JwksFetchError(`JWKS endpoint returned HTTP ${response.status}`);
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
    keys: keys as Jwk[],
    freshUntilMs: fetchedAt + maxAge * 1000,
    staleUntilMs: fetchedAt + (maxAge + swr) * 1000,
  };
}

/**
 * Override-path JWKS source. Honors the fresh and stale-while-revalidate
 * windows exactly like the bespoke getJwks did: fresh entries are returned
 * directly, stale-but-tolerable entries are returned immediately while a
 * background refresh runs, and past the SWR window callers block on the
 * refresh (coalesced onto one inflight request).
 */
async function getDocKeys(cfg: VerifierConfig): Promise<Jwk[]> {
  const store = docStoreFor(cfg.jwksUrl);
  const clock = cfg.now ?? Date.now;
  const fetcher = cfg.fetcher ?? fetch;
  const now = clock();

  if (store.entry && now < store.entry.freshUntilMs) {
    return store.entry.keys;
  }

  if (store.entry && now < store.entry.staleUntilMs) {
    if (!store.inflight) {
      store.inflight = fetchJwksDoc(cfg.jwksUrl, fetcher, clock)
        .then((next) => {
          store.entry = next;
          return next;
        })
        .catch((err: Error) => {
          // Swallow background refresh failures; we still have a stale
          // entry. Surface the error on the next cold fetch.
          // eslint-disable-next-line no-console
          console.warn(
            "[portal-verify-shared] background JWKS refresh failed:",
            err.message,
          );
          throw err;
        })
        .finally(() => {
          store.inflight = null;
        });
      // Detach so a background failure can never become an unhandled
      // rejection; later awaiters still see the original rejection.
      store.inflight.catch(() => undefined);
    }
    return store.entry.keys;
  }

  if (!store.inflight) {
    store.inflight = fetchJwksDoc(cfg.jwksUrl, fetcher, clock)
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

function cacheFor(cfg: VerifierConfig): InMemoryJwksCache {
  if (cfg.fetcher || cfg.now) {
    // Test seam: translate the injected fetch/clock into the library's
    // injectable fetchJwks/now on a fresh per-call cache. Cross-call cache
    // semantics live in the document cache behind it.
    return new InMemoryJwksCache({
      jwksUri: cfg.jwksUrl,
      ttlMs: MAX_TTL_MS,
      fetchJwks: () => getDocKeys(cfg),
      now: cfg.now,
    });
  }
  let cache = sharedCaches.get(cfg.jwksUrl);
  if (!cache) {
    cache = new InMemoryJwksCache({
      jwksUri: cfg.jwksUrl,
      // Contract max-age is 3600s; the library clamps TTL to [10, 60] min,
      // so this lands exactly on the contract value.
      ttlMs: MAX_TTL_MS,
      fetchJwks: async (uri) => (await fetchJwksDoc(uri, fetch, Date.now)).keys,
    });
    sharedCaches.set(cfg.jwksUrl, cache);
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Error translation: library AuthError codes -> this app's typed errors
// ---------------------------------------------------------------------------

/** Leniently decode the payload segment for error-message fidelity only. */
function decodedPayload(token: string): Record<string, unknown> {
  try {
    const segments = token.split(".");
    if (segments.length !== 3) return {};
    return JSON.parse(
      Buffer.from(segments[1] as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function translate(err: unknown, token: string, cfg: VerifierConfig): Error {
  if (err instanceof PortalVerifyError) {
    // Our fetch layer already threw the app-typed error (JwksFetchError).
    return err;
  }
  if (!(err instanceof AuthError)) {
    // The library throws AuthError for every verification failure, so
    // anything else bubbled up from key import or an injected fetcher.
    // Mirror the bespoke catch-all.
    return new MalformedToken(
      err instanceof Error ? err.message : "token failed verification",
    );
  }
  switch (err.code) {
    case "malformed_token":
    case "invalid_algorithm":
      return new MalformedToken(err.message);
    case "missing_kid":
      // Contract tokens always carry a kid; the bespoke engine tolerated a
      // missing one by trying every key. Documented delta: reject.
      return new MalformedToken(err.message);
    case "unknown_kid":
    case "invalid_signature":
      // The bespoke engine reached BadSignature for unpublished kids by
      // trying (and failing) every key; the library short-circuits at kid
      // lookup after its one rotation refetch. Same observable class.
      return new BadSignature();
    case "token_expired":
      return new Expired();
    case "not_yet_valid":
      // jose surfaced nbf failures as claim-validation errors, which the
      // bespoke engine folded into MalformedToken. Keep that mapping.
      return new MalformedToken(err.message);
    case "missing_claim":
      // Missing exp. Documented delta: the bespoke engine accepted exp-less
      // tokens; the library (correctly) requires exp.
      return new MalformedToken(err.message);
    case "invalid_issuer": {
      const iss = decodedPayload(token).iss;
      return new WrongIssuer(
        cfg.expectedIssuer,
        typeof iss === "string" ? iss : undefined,
      );
    }
    case "invalid_audience": {
      const aud = decodedPayload(token).aud;
      return new WrongAudience(
        cfg.expectedAudience,
        typeof aud === "string" || Array.isArray(aud)
          ? (aud as string | string[])
          : undefined,
      );
    }
    case "jwks_fetch_failed":
      return new JwksFetchError(err.message);
    default:
      return new MalformedToken(err.message);
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a portal-minted JWT through the shared library. Same contract as
 * the bespoke verifyPortalToken: resolves to the parsed claims or throws a
 * typed PortalVerifyError subclass.
 */
export async function verifySharedPortalToken(
  token: string,
  cfg: VerifierConfig,
): Promise<PortalClaims> {
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new MalformedToken();
  }

  let claims: JwtClaims;
  try {
    claims = await verifyToken(token, {
      issuer: cfg.expectedIssuer,
      audience: cfg.expectedAudience,
      cache: cacheFor(cfg),
      clockToleranceSec: CLOCK_SKEW_SECONDS,
      // NOTE: no `now` here on purpose. As in the bespoke engine, cfg.now
      // drives only JWKS cache freshness; temporal claim checks always run
      // against real system time.
    });
  } catch (err) {
    throw translate(err, token, cfg);
  }

  // The library does not gate iat; keep the bespoke check verbatim (jose
  // validated exp during jwtVerify, then the bespoke engine checked iat
  // last, against the real clock, with the same skew tolerance).
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof claims.iat !== "number" ||
    claims.iat - CLOCK_SKEW_SECONDS > nowSeconds
  ) {
    throw new IssuedInFuture();
  }

  return claims as unknown as PortalClaims;
}
