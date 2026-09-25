import { withTenant, type TenantDb } from "./pg";

/**
 * Which tenant is this request for?
 *
 * TODAY THE ANSWER IS ALWAYS "sample", AND THAT IS A DELIBERATE PLACEHOLDER,
 * not an oversight. The public demo is a single shared world: `POST
 * /api/session` sets a hardcoded "demo-user" cookie that middleware checks only
 * for PRESENCE, so every visitor is literally the same user. There is no
 * per-visitor identity to derive a tenant from yet.
 *
 * The reserved `sample` tenant is what the 6-hourly demo reset restores, and
 * keeping it named rather than implicit is what makes that reset a bounded
 * DELETE + INSERT ... SELECT instead of "wipe the database".
 *
 * WHAT MUST NOT HAPPEN: a real tenant arriving through the portal JWT (which
 * does carry customer_id) and landing in `sample`. When portal-backed tenancy
 * is wired in, this function reads the verified session and returns that
 * tenant; the signed-out demo keeps `sample`. Because every query takes its
 * tenant from the TenantDb handed to it, that change happens HERE and nowhere
 * else -- no query function needs touching.
 */
export const SAMPLE_TENANT = "sample";

export function currentTenantId(): string {
  return SAMPLE_TENANT;
}

/**
 * Run `fn` against the current request's tenant, in one transaction.
 *
 * Pages and route handlers should call this ONCE and do all their reads inside
 * it, rather than calling it per query: one transaction per render gives a
 * consistent snapshot, and it is also the only thing that keeps
 * `app.tenant_id` in scope for RLS.
 */
export function withCurrentTenant<T>(fn: (db: TenantDb) => Promise<T>): Promise<T> {
  return withTenant(currentTenantId(), fn);
}
