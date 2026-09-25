/**
 * Integration tests for POST /api/work-orders (D-012, anonymous by design).
 *
 * MOVED FROM route.test.ts TO route.itest.ts BY THE POSTGRES PORT. It was
 * always an integration test -- it drove the real handlers against a real
 * database -- but the database used to be a throwaway SQLite FILE, which the
 * unit suite could create for itself. It now needs a running Postgres, so it
 * belongs in the suite that has one (`npm run test:rls`) rather than in
 * `npm test`, which must stay database-free.
 *
 * NOT ONE ASSERTION CHANGED. Every test below still asserts exactly what it
 * asserted against SQLite: that visitor free text is never persisted (D-012),
 * that assigned_to must resolve to a real technician (deep-verify PR #24
 * blocker B1), and the W2/W4/W5 fixes. Only the plumbing moved. Rewriting the
 * assertions during a port is how a port quietly loses the coverage it was
 * supposed to preserve.
 *
 * The fixture seeds the SAMPLE tenant, because that is the tenant the route
 * handlers resolve to (src/lib/tenant.ts). Seeding any other tenant would
 * leave the handlers reading an empty world and every "nothing was stored"
 * assertion would pass for the wrong reason.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { seedFixturePg } from "@/lib/test-helpers/axlepoint-pg-fixtures";
import { deriveRecommendedWorkOrder } from "@/lib/predictive-action";
import { SAMPLE_TENANT, withCurrentTenant } from "@/lib/tenant";
import { closePool } from "@/lib/pg";

let POST: typeof import("./route").POST;
let PATCH: typeof import("./[id]/route").PATCH;
let queries: typeof import("@/lib/queries");
let admin: Pool;
let adminUrl: string;

/**
 * The same three query functions the tests always used, each wrapped in the
 * one transaction the app would use. Kept as thin named helpers so the call
 * sites below read as they did before the port.
 */
const q = {
  getWorkOrder: (id: string) =>
    withCurrentTenant((db) => queries.getWorkOrder(db, id)),
  getWorkOrders: () => withCurrentTenant((db) => queries.getWorkOrders(db)),
  getAsset: (id: string) => withCurrentTenant((db) => queries.getAsset(db, id)),
};

const URL = "http://localhost:3000/api/work-orders";

function formRequest(fields: Record<string, string>): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Everything readable through the same query functions the app's pages use. */
async function allStoredText(): Promise<string> {
  return JSON.stringify(await q.getWorkOrders());
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. These tests DROP AND RECREATE the public " +
        "schema, so they refuse to guess. See docker-compose.dev.yml.",
    );
  }
  for (const smell of ["neon.tech", "prod", "portal"]) {
    if (url.toLowerCase().includes(smell)) {
      throw new Error(`DATABASE_URL contains "${smell}". Refusing: this drops schemas.`);
    }
  }
  adminUrl = url;
  admin = new Pool({ connectionString: url });

  ({ POST } = await import("./route"));
  ({ PATCH } = await import("./[id]/route"));
  queries = await import("@/lib/queries");
});

afterAll(async () => {
  await closePool();
  if (admin) await admin.end();
  // RESTORE THE ADMIN URL. This file rewrites process.env.DATABASE_URL to the
  // unprivileged role, and process env is shared by every file in the run.
  // Leaving it rewritten made the suite's result depend on which file vitest
  // happened to run first: pg.rls.itest.ts would then try DROP SCHEMA as
  // axlepoint_app and fail. Sequential execution is not isolation.
  if (adminUrl) process.env.DATABASE_URL = adminUrl;
});

beforeEach(async () => {
  // A fresh world per test, as the SQLite version got by rewriting its file.
  await seedFixturePg(admin, SAMPLE_TENANT);
  // The pool must be rebuilt after the role's password is (re)set, and so that
  // no client carries state from the schema that was just dropped.
  await closePool();
  process.env.DATABASE_URL = appUrl(process.env.DATABASE_URL as string);
});

/** The same server, as the unprivileged application role. */
function appUrl(adminUrl: string): string {
  const u = new globalThis.URL(adminUrl);
  u.username = "axlepoint_app";
  u.password = "axlepoint_app";
  return u.toString();
}

describe("POST /api/work-orders -- visitor free text is never persisted", () => {
  it("never stores the title or description typed via the form", async () => {
    const secretTitle = "VISITOR-A-SECRET-TITLE-4f8c1e";
    const secretDescription = "VISITOR-A-SECRET-DESCRIPTION-9b2d77, do not leak";

    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: secretTitle,
        description: secretDescription,
        type: "corrective",
        priority: "high",
      }),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    const id = location.match(/work-orders\/(WO-\d+)/)?.[1];
    expect(id).toBeTruthy();

    // "Visitor B" (or the same visitor a moment later -- there is no
    // per-visitor identity here, which is the point) reads it back through
    // the exact functions the app's server-rendered pages call.
    const detail = await q.getWorkOrder(id as string);
    expect(detail).toBeTruthy();
    expect(detail?.title).not.toContain(secretTitle);
    expect(detail?.description).not.toContain(secretDescription);

    const dump = await allStoredText();
    expect(dump).not.toContain(secretTitle);
    expect(dump).not.toContain(secretDescription);
  });

  it("never stores the title or description typed via the JSON path (Recommend Preventive Action)", async () => {
    const secretTitle = "VISITOR-JSON-SECRET-TITLE-71ac";
    const secretDescription = "VISITOR-JSON-SECRET-DESCRIPTION-33fe, leak check";

    const res = await POST(
      jsonRequest({
        asset_id: "AST-01",
        title: secretTitle,
        description: secretDescription,
        type: "predictive",
        priority: "high",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.id).toMatch(/^WO-\d+$/);

    const detail = await q.getWorkOrder(body.id);
    expect(detail?.title).not.toContain(secretTitle);
    expect(detail?.description).not.toContain(secretDescription);

    const dump = await allStoredText();
    expect(dump).not.toContain(secretTitle);
    expect(dump).not.toContain(secretDescription);
  });

  it("derives a stable, non-empty title from the asset and type instead", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "Whatever the visitor happened to type",
        description: "irrelevant, discarded either way",
        type: "preventive",
        priority: "low",
      }),
    );
    const id = (res.headers.get("location") ?? "").match(/work-orders\/(WO-\d+)/)?.[1];
    const detail = await q.getWorkOrder(id as string);
    expect(detail?.title).toBe("Preventive - Meridian V12T #04");
    expect(detail?.description).toContain("isn't stored in this demo");
  });

  it("keeps the 'Recommend Preventive Action' headline flow telling its story (predictive type)", async () => {
    // The button sends its own preview text; the route must ignore it and
    // derive the stored title/description from the asset's own
    // risk_factors instead (D-012), so predictive work orders do not
    // degrade to the generic "Predictive - <asset>" placeholder.
    const res = await POST(
      jsonRequest({
        asset_id: "AST-01",
        title: "VISITOR-PREVIEW-TITLE-should-be-ignored",
        description: "VISITOR-PREVIEW-DESCRIPTION-should-be-ignored",
        type: "predictive",
        priority: "high",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const detail = await q.getWorkOrder(body.id);

    const asset = await q.getAsset("AST-01");
    const expected = deriveRecommendedWorkOrder(asset!);
    expect(detail?.title).toBe(expected.title);
    expect(detail?.description).toBe(expected.description);
    expect(detail?.title).toContain("Inspect lube oil system");
    expect(detail?.description).toContain("Driving signal: oil pressure");
  });
});

describe("assigned_to must resolve to a real technician (deep-verify PR #24 blocker B1)", () => {
  it("POST (form): rejects a marker string (relative redirect with the reason) and never stores it", async () => {
    // Form posts always get the 303 reject path (see the route's reject()
    // helper) with the reason in the query string, same as the existing
    // junk-title rejection -- not a raw 422 like the JSON path below.
    const marker = "B1-MARKER-form-assigned-to-9f21";
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        assigned_to: marker,
      }),
    );
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("error=Unknown%20technician.");
    expect((await allStoredText())).not.toContain(marker);
  });

  it("POST (JSON): rejects a marker string with 422 and never stores it", async () => {
    const marker = "B1-MARKER-json-assigned-to-4c88";
    const res = await POST(
      jsonRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        assigned_to: marker,
      }),
    );
    expect(res.status).toBe(422);
    expect((await allStoredText())).not.toContain(marker);
  });

  it("POST: empty or absent assigned_to still clears to null (unaffected by the fix)", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        assigned_to: "",
      }),
    );
    expect(res.status).toBe(303);
    const id = (res.headers.get("location") ?? "").match(/work-orders\/(WO-\d+)/)?.[1] as string;
    expect((await q.getWorkOrder(id))?.assigned_to).toBeNull();
  });

  it("PATCH assign: rejects a marker string on a seed work order with 422 and leaves its real assignment untouched", async () => {
    // WO-1 seeds with assigned_to = 'TCH-01' (see axlepoint-fixtures.ts) so
    // this proves the rejected write left the existing value alone, not
    // just that a marker failed to appear on a column that started empty
    // -- this is the exact row shape B1 attacked (a pre-existing/seed row).
    const marker = "B1-MARKER-patch-seed-assign-1a77";
    const before = (await q.getWorkOrder("WO-1"))?.assigned_to;
    expect(before).toBe("TCH-01");

    const res = await PATCH(
      new NextRequest("http://localhost:3000/api/work-orders/WO-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assigned_to: marker }),
      }),
      { params: Promise.resolve({ id: "WO-1" }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unknown technician.");
    expect((await q.getWorkOrder("WO-1"))?.assigned_to).toBe("TCH-01");
    expect((await allStoredText())).not.toContain(marker);
  });

  it("PATCH assign: rejects a marker string on a freshly created work order with 422 and never stores it", async () => {
    const marker = "B1-MARKER-patch-new-assign-6e02";
    const createRes = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
      }),
    );
    const id = (createRes.headers.get("location") ?? "")
      .match(/work-orders\/(WO-\d+)/)?.[1] as string;

    const res = await PATCH(
      new NextRequest(`http://localhost:3000/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assigned_to: marker }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(422);
    expect((await q.getWorkOrder(id))?.assigned_to).toBeNull();
    expect((await allStoredText())).not.toContain(marker);
  });

  it("PATCH assign: still accepts a real technician id and still accepts clearing to null", async () => {
    const assignRes = await PATCH(
      new NextRequest("http://localhost:3000/api/work-orders/WO-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assigned_to: "TCH-01" }),
      }),
      { params: Promise.resolve({ id: "WO-1" }) },
    );
    expect(assignRes.status).toBe(200);
    expect((await q.getWorkOrder("WO-1"))?.assigned_to).toBe("TCH-01");

    const clearRes = await PATCH(
      new NextRequest("http://localhost:3000/api/work-orders/WO-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assigned_to: null }),
      }),
      { params: Promise.resolve({ id: "WO-1" }) },
    );
    expect(clearRes.status).toBe(200);
    expect((await q.getWorkOrder("WO-1"))?.assigned_to).toBeNull();
  });
});

describe("POST /api/work-orders -- W2/W4/W5 fixes (deep-verify PR #24)", () => {
  it("W2: the created-order redirect Location is relative, not built from request.url", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
      }),
    );
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/app/work-orders/")).toBe(true);
    expect(location).not.toContain("0.0.0.0");
    expect(location).not.toMatch(/^https?:\/\//);
  });

  it("W4: rejects an unparseable due_date with 422 instead of silently storing NULL", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        due_date: "not-a-date",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("error=");
  });

  it("W4: still accepts a valid due_date", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        due_date: "2027-01-15",
      }),
    );
    expect(res.status).toBe(303);
    const id = (res.headers.get("location") ?? "").match(/work-orders\/(WO-\d+)/)?.[1] as string;
    expect((await q.getWorkOrder(id))?.due_at).toBeTruthy();
  });

  it("W5: rejects an overflow date (2026-02-30) instead of silently rolling it to March 2", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        due_date: "2026-02-30",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("error=Invalid%20due%20date.");
  });

  it("W5: treats a whitespace-only due_date as a clear, not an error (same as PATCH now)", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
        due_date: "   ",
      }),
    );
    expect(res.status).toBe(303);
    const id = (res.headers.get("location") ?? "").match(/work-orders\/(WO-\d+)/)?.[1] as string;
    expect((await q.getWorkOrder(id))?.due_at).toBeNull();
  });

  it("W5: PATCH due rejects the same overflow date POST now rejects", async () => {
    const res = await PATCH(
      new NextRequest("http://localhost:3000/api/work-orders/WO-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "due", due_date: "2026-02-30" }),
      }),
      { params: Promise.resolve({ id: "WO-1" }) },
    );
    expect(res.status).toBe(422);
  });

  it("W5: PATCH due now clears on whitespace-only, matching POST", async () => {
    const res = await PATCH(
      new NextRequest("http://localhost:3000/api/work-orders/WO-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "due", due_date: "   " }),
      }),
      { params: Promise.resolve({ id: "WO-1" }) },
    );
    expect(res.status).toBe(200);
    expect((await q.getWorkOrder("WO-1"))?.due_at).toBeNull();
  });
});

describe("POST /api/work-orders -- the demo flow still works end to end", () => {
  it("creates a work order visible on the list and detail pages", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        description: "some notes about the job",
        type: "preventive",
        priority: "low",
        assigned_to: "TCH-01",
      }),
    );
    expect(res.status).toBe(303);
    const id = (res.headers.get("location") ?? "").match(/work-orders\/(WO-\d+)/)?.[1] as string;

    const list = await q.getWorkOrders();
    expect(list.some((w) => w.id === id)).toBe(true);

    const detail = await q.getWorkOrder(id);
    expect(detail).toMatchObject({
      id,
      asset_id: "AST-01",
      type: "preventive",
      priority: "low",
      status: "open",
      assigned_to: "TCH-01",
    });
  });

  it("still rejects junk titles via the existing screen (validation UX unaffected)", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "test",
        type: "preventive",
        priority: "low",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("error=");
  });

  it("still rejects an unknown asset", async () => {
    const res = await POST(
      formRequest({
        asset_id: "AST-DOES-NOT-EXIST",
        title: "A perfectly normal title",
        type: "preventive",
        priority: "low",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("error=");
  });

  it("still supports the assign -> status closed-loop patch flow (D-017)", async () => {
    const createRes = await POST(
      formRequest({
        asset_id: "AST-01",
        title: "A perfectly normal work order title",
        type: "corrective",
        priority: "medium",
      }),
    );
    const id = (createRes.headers.get("location") ?? "")
      .match(/work-orders\/(WO-\d+)/)?.[1] as string;

    const patchRequest = (body: unknown) =>
      new NextRequest(`http://localhost:3000/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const assignRes = await PATCH(patchRequest({ action: "assign", assigned_to: "TCH-01" }), {
      params: Promise.resolve({ id }),
    });
    expect(assignRes.status).toBe(200);
    expect((await q.getWorkOrder(id))?.assigned_to).toBe("TCH-01");

    const statusRes = await PATCH(patchRequest({ action: "status", status: "in_progress" }), {
      params: Promise.resolve({ id }),
    });
    expect(statusRes.status).toBe(200);
    expect((await q.getWorkOrder(id))?.status).toBe("in_progress");

    const closeRes = await PATCH(patchRequest({ action: "status", status: "closed" }), {
      params: Promise.resolve({ id }),
    });
    expect(closeRes.status).toBe(200);
    const closed = await q.getWorkOrder(id);
    expect(closed?.status).toBe("closed");
    expect(closed?.completed_at).toBeTruthy();
  });
});
