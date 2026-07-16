/**
 * Portal token verification -- dispatch layer (CA5 cutover).
 *
 * The default engine is the shared @paradigm-codes/auth client library (K4),
 * the same verifier every Paradigm consumer standardizes on. The pre-CA5
 * bespoke engine is preserved verbatim in ./portal-verify-bespoke.ts as a
 * rollback path for one release:
 *
 *   PORTAL_VERIFIER=bespoke    # flips back without a code change or deploy
 *
 * The public API (typed PortalVerifyError subclasses, PortalClaims,
 * VerifierConfig, env parsing, test reset) is unchanged from the bespoke
 * module; callers and tests are agnostic to which engine ran. Remove the
 * flag and the bespoke module together once the shared engine has survived
 * a release in production.
 */

import {
  verifyPortalToken as verifyWithBespoke,
  _resetPortalVerifyCachesForTests as resetBespokeCaches,
  type PortalClaims,
  type VerifierConfig,
} from "./portal-verify-bespoke";
import {
  verifySharedPortalToken,
  _resetSharedPortalVerifyCachesForTests,
} from "./portal-verify-shared";

export {
  BadSignature,
  Expired,
  IssuedInFuture,
  JwksFetchError,
  MalformedToken,
  PortalVerifyError,
  UnknownKid,
  WrongAudience,
  WrongIssuer,
  verifierConfigFromEnv,
} from "./portal-verify-bespoke";
export type { PortalClaims, VerifierConfig } from "./portal-verify-bespoke";

/**
 * Verify a JWT minted by the Paradigm Portal. On success, returns the parsed
 * claims. On failure, throws a typed PortalVerifyError subclass. Engine
 * selection is per call, so the rollback flag needs no process restart.
 */
export async function verifyPortalToken(
  token: string,
  cfg: VerifierConfig,
): Promise<PortalClaims> {
  if (process.env.PORTAL_VERIFIER === "bespoke") {
    return verifyWithBespoke(token, cfg);
  }
  return verifySharedPortalToken(token, cfg);
}

/** Test helper: reset both engines' JWKS caches between cases. */
export function _resetPortalVerifyCachesForTests(): void {
  resetBespokeCaches();
  _resetSharedPortalVerifyCachesForTests();
}
