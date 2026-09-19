/**
 * Integration tests for POST /api/work-orders (D-012, anonymous by design).
 *
 * Env vars are set before any import so db.ts (imported transitively via
 * queries.ts) opens a throwaway fixture database instead of the real one.
 * The reset scheduler is disabled here on purpose -- these tests are about
 * what gets persisted per request, not the seed-reset timer, which has its
 * own coverage in src/lib/db.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { seedFixtureDb } from "@/lib/test-helpers/axlepoint-fixtures";
import { deriveRecommendedWorkOrder } from "@/lib/predictive-action";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "axlepoint-wo-route-"));
const LIVE = path.join(TMP_DIR, "axlepoint.db");

process.env.AXLEPOINT_DB_PATH = LIVE;
process.env.AXLEPOINT_SEED_DB_PATH = path.join(TMP_DIR, "axlepoint.seed.db");
process.env.AXLEPOINT_RESET_DISABLED = "1";

let POST: typeof import("./route").POST;
let PATCH: typeof import("./[id]/route").PATCH;
let queries: typeof import("@/lib/queries");
let dbModule: typeof import("@/lib/db");

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
function allStoredText(): string {
  const rows = queries.getWorkOrders();
  return JSON.stringify(rows);
}

beforeAll(async () => {
  ({ POST } = await import("./route"));
  ({ PATCH } = await import("./[id]/route"));
  queries = await import("@/lib/queries");
  dbModule = await import("@/lib/db");
});

beforeEach(() => {
  // Close any connection a previous test left open first -- on Windows,
  // rewriting the file while better-sqlite3 still holds it open fails
  // with EBUSY.
  dbModule._resetAxlepointDbStateForTests();
  seedFixtureDb(LIVE);
});

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
    const detail = queries.getWorkOrder(id as string);
    expect(detail).toBeTruthy();
    expect(detail?.title).not.toContain(secretTitle);
    expect(detail?.description).not.toContain(secretDescription);

    const dump = allStoredText();
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

    const detail = queries.getWorkOrder(body.id);
    expect(detail?.title).not.toContain(secretTitle);
    expect(detail?.description).not.toContain(secretDescription);

    const dump = allStoredText();
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
    const detail = queries.getWorkOrder(id as string);
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
    const detail = queries.getWorkOrder(body.id);

    const asset = queries.getAsset("AST-01");
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
    expect(allStoredText()).not.toContain(marker);
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
    expect(allStoredText()).not.toContain(marker);
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
    expect(queries.getWorkOrder(id)?.assigned_to).toBeNull();
  });

  it("PATCH assign: rejects a marker string on a seed work order with 422 and leaves its real assignment untouched", async () => {
    // WO-1 seeds with assigned_to = 'TCH-01' (see axlepoint-fixtures.ts) so
    // this proves the rejected write left the existing value alone, not
    // just that a marker failed to appear on a column that started empty
    // -- this is the exact row shape B1 attacked (a pre-existing/seed row).
    const marker = "B1-MARKER-patch-seed-assign-1a77";
    const before = queries.getWorkOrder("WO-1")?.assigned_to;
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
    expect(queries.getWorkOrder("WO-1")?.assigned_to).toBe("TCH-01");
    expect(allStoredText()).not.toContain(marker);
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
    expect(queries.getWorkOrder(id)?.assigned_to).toBeNull();
    expect(allStoredText()).not.toContain(marker);
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
    expect(queries.getWorkOrder("WO-1")?.assigned_to).toBe("TCH-01");

    const clearRes = await PATCH(
      new NextRequest("http://localhost:3000/api/work-orders/WO-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assigned_to: null }),
      }),
      { params: Promise.resolve({ id: "WO-1" }) },
    );
    expect(clearRes.status).toBe(200);
    expect(queries.getWorkOrder("WO-1")?.assigned_to).toBeNull();
  });
});

describe("POST /api/work-orders -- W2/W4 fixes (deep-verify PR #24)", () => {
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
    expect(queries.getWorkOrder(id)?.due_at).toBeTruthy();
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

    const list = queries.getWorkOrders();
    expect(list.some((w) => w.id === id)).toBe(true);

    const detail = queries.getWorkOrder(id);
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

  it("still supports the assign -> status closed-loop patch flow (D-007)", async () => {
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
    expect(queries.getWorkOrder(id)?.assigned_to).toBe("TCH-01");

    const statusRes = await PATCH(patchRequest({ action: "status", status: "in_progress" }), {
      params: Promise.resolve({ id }),
    });
    expect(statusRes.status).toBe(200);
    expect(queries.getWorkOrder(id)?.status).toBe("in_progress");

    const closeRes = await PATCH(patchRequest({ action: "status", status: "closed" }), {
      params: Promise.resolve({ id }),
    });
    expect(closeRes.status).toBe(200);
    const closed = queries.getWorkOrder(id);
    expect(closed?.status).toBe("closed");
    expect(closed?.completed_at).toBeTruthy();
  });
});
