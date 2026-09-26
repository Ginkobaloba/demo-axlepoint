import type { TenantDb } from "./pg";
import { completionForStatus } from "./wo-actions";
import { recommendedReorderQty } from "./po-actions";
import type {
  Anomaly,
  Asset,
  MaintenanceTask,
  Part,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  SensorType,
  Technician,
  WorkOrder,
  WorkOrderPriority,
  WorkOrderStatus,
  WorkOrderType,
} from "./types";

/**
 * Every query function takes a TenantDb and returns a Promise. Both are load
 * bearing.
 *
 * THE Promise<T> IS THE POINT, not a consequence of the driver. better-sqlite3
 * was synchronous; every Postgres driver is not, so the port turns ~44 sync
 * functions async and every one of their ~21 callers needs an await. A missed
 * await on a function that used to return data is not reliably loud: `.map()`
 * on a Promise throws, but a Promise passed straight into JSX renders as
 * nothing and a Promise used in a boolean test is always truthy. Making every
 * return type Promise<T> turns that whole class of mistake into a COMPILE
 * error. queries.types.test.ts asserts the contract so a future `any` cannot
 * hollow it out.
 *
 * TENANT SCOPING IS IN THE WHERE CLAUSE, deliberately and redundantly. RLS
 * (D-022) also constrains every statement here, but app-level filtering is the
 * PRIMARY control: it is testable without a database, it does not depend on a
 * driver's transaction semantics, and it survives someone connecting as a role
 * that bypasses RLS. RLS is the net under it, not the floor.
 *
 * THE DIALECT CHANGES ARE NOT ALL COSMETIC. Recorded in D-024; the ones that
 * would have failed silently rather than loudly are marked at their call sites.
 */

const DAY = 86400;

export async function getGeneratedAt(db: TenantDb): Promise<number> {
  const rows = await db.query<{ value: string }>(
    "SELECT value FROM meta WHERE tenant_id = $1 AND key = 'generated_at'",
    [db.tenantId],
  );
  return Number(rows[0]?.value);
}

// ----------------------------------------------------------------- dashboard

export interface Kpis {
  assetsMonitored: number;
  criticalAssets: number;
  openWorkOrders: number;
  mtbfHours: number;
  mtbfDeltaPct: number;
}

export async function getKpis(db: TenantDb): Promise<Kpis> {
  const t = db.tenantId;
  const now = await getGeneratedAt(db);

  // COUNT(*) is int8, which node-postgres returns as a STRING unless the type
  // parser in pg.ts is registered. ::int keeps that independent of a global
  // setting for the values that feed arithmetic.
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ c: number }>(sql, params))[0].c;

  const assetsMonitored = await one(
    "SELECT COUNT(*)::int c FROM assets WHERE tenant_id = $1",
    [t],
  );
  const criticalAssets = await one(
    "SELECT COUNT(*)::int c FROM assets WHERE tenant_id = $1 AND risk_band = 'critical'",
    [t],
  );
  const openWorkOrders = await one(
    "SELECT COUNT(*)::int c FROM work_orders WHERE tenant_id = $1 AND status <> 'closed'",
    [t],
  );

  // Fleet MTBF proxy: fleet operating hours divided by unplanned-failure
  // work orders (corrective) raised in the window, trailing 30 days vs the
  // 30 days before that.
  const failures = (from: number, to: number) =>
    one(
      `SELECT COUNT(*)::int c FROM work_orders
        WHERE tenant_id = $1 AND type = 'corrective' AND created_at >= $2 AND created_at < $3`,
      [t, from, to],
    );
  const fleetHours = assetsMonitored * 30 * 24;
  const recent = Math.max(1, await failures(now - 30 * DAY, now));
  const prior = Math.max(1, await failures(now - 60 * DAY, now - 30 * DAY));
  const mtbfRecent = fleetHours / recent;
  const mtbfPrior = fleetHours / prior;

  return {
    assetsMonitored,
    criticalAssets,
    openWorkOrders,
    mtbfHours: Math.round(mtbfRecent),
    mtbfDeltaPct: Math.round(((mtbfRecent - mtbfPrior) / mtbfPrior) * 100),
  };
}

export async function getTopRiskAssets(db: TenantDb, limit = 10): Promise<Asset[]> {
  return db.query<Asset>(
    "SELECT * FROM assets WHERE tenant_id = $1 ORDER BY risk_score DESC LIMIT $2",
    [db.tenantId, limit],
  );
}

export interface AnomalyWithAsset extends Anomaly {
  asset_name: string;
  asset_location: string;
}

export async function getRecentAnomalies(
  db: TenantDb,
  limit = 12,
): Promise<AnomalyWithAsset[]> {
  return db.query<AnomalyWithAsset>(
    `SELECT a.*, s.name AS asset_name, s.location AS asset_location
       FROM anomalies a
       JOIN assets s ON s.id = a.asset_id AND s.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
      ORDER BY a.ts DESC LIMIT $2`,
    [db.tenantId, limit],
  );
}

export async function getRiskBandCounts(
  db: TenantDb,
): Promise<{ risk_band: string; c: number }[]> {
  return db.query<{ risk_band: string; c: number }>(
    "SELECT risk_band, COUNT(*)::int c FROM assets WHERE tenant_id = $1 GROUP BY risk_band",
    [db.tenantId],
  );
}

export async function getLocationRiskMatrix(db: TenantDb): Promise<
  {
    location: string;
    type: string;
    c: number;
    maxScore: number;
  }[]
> {
  // "maxScore" IS QUOTED, and must stay quoted. Postgres folds unquoted
  // identifiers to lower case, so `MAX(risk_score) maxScore` returns a column
  // named `maxscore` -- the query succeeds, the TypeScript still says
  // maxScore, and every value is undefined. SQLite preserved the case, so this
  // is a port-only failure and a silent one.
  return db.query<{ location: string; type: string; c: number; maxScore: number }>(
    `SELECT location, type, COUNT(*)::int c, MAX(risk_score) AS "maxScore"
       FROM assets WHERE tenant_id = $1 GROUP BY location, type`,
    [db.tenantId],
  );
}

// -------------------------------------------------------------------- assets

export interface AssetFilters {
  q?: string;
  type?: string;
  location?: string;
  band?: string;
}

export async function getAssets(
  db: TenantDb,
  filters: AssetFilters = {},
): Promise<Asset[]> {
  const params: unknown[] = [];
  // bind() pushes the value AND returns its placeholder, so the number can
  // never drift from the position. Computing "$" + (params.length + n) by hand
  // is correct exactly until someone adds a clause, and the failure is a query
  // that binds the right values to the wrong columns.
  const bind = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };

  const clauses: string[] = [`tenant_id = ${bind(db.tenantId)}`];

  if (filters.q) {
    // ILIKE, NOT LIKE. SQLite's LIKE is case-insensitive for ASCII by default;
    // Postgres LIKE is case-sensitive. A straight translation would keep
    // working and quietly stop matching "Pump" for "pump" -- no error, just a
    // worse search.
    const like = `%${filters.q}%`;
    clauses.push(
      `(id ILIKE ${bind(like)} OR name ILIKE ${bind(like)} OR model ILIKE ${bind(like)})`,
    );
  }
  if (filters.type) clauses.push(`type = ${bind(filters.type)}`);
  if (filters.location) clauses.push(`location = ${bind(filters.location)}`);
  if (filters.band) clauses.push(`risk_band = ${bind(filters.band)}`);

  return db.query<Asset>(
    `SELECT * FROM assets WHERE ${clauses.join(" AND ")} ORDER BY risk_score DESC, id`,
    params,
  );
}

export async function getAsset(db: TenantDb, id: string): Promise<Asset | undefined> {
  const rows = await db.query<Asset>(
    "SELECT * FROM assets WHERE tenant_id = $1 AND id = $2",
    [db.tenantId, id],
  );
  return rows[0];
}

export async function getLocations(db: TenantDb): Promise<string[]> {
  const rows = await db.query<{ location: string }>(
    "SELECT DISTINCT location FROM assets WHERE tenant_id = $1 ORDER BY location",
    [db.tenantId],
  );
  return rows.map((r) => r.location);
}

export async function getAssetSensors(
  db: TenantDb,
  assetId: string,
): Promise<SensorType[]> {
  const rows = await db.query<{ sensor_type: SensorType }>(
    "SELECT DISTINCT sensor_type FROM sensor_readings WHERE tenant_id = $1 AND asset_id = $2",
    [db.tenantId, assetId],
  );
  return rows.map((r) => r.sensor_type);
}

export async function getReadings(
  db: TenantDb,
  assetId: string,
  sensor: SensorType,
  fromTs: number,
): Promise<{ ts: number; value: number }[]> {
  // ts is bigint, which node-postgres hands back as a STRING. pg.ts registers
  // an int8 parser, and MEASURED 2026-09-26 against a real database, that
  // parser does not take effect in the built Next server: this endpoint
  // returned ts as "1789797600" while TypeScript insisted it was a number.
  // The sensor chart's x-axis then rendered no labels at all, because tick
  // arithmetic on a string CONCATENATES instead of adding.
  //
  // So the conversion is done here rather than left to a global side effect
  // whose reach depends on module identity in a bundler. Epoch seconds are
  // ~1.8e9, far below Number.MAX_SAFE_INTEGER, so this is lossless.
  const rows = await db.query<{ ts: number | string; value: number }>(
    `SELECT ts, value FROM sensor_readings
      WHERE tenant_id = $1 AND asset_id = $2 AND sensor_type = $3 AND ts >= $4
      ORDER BY ts`,
    [db.tenantId, assetId, sensor, fromTs],
  );
  return rows.map((row) => ({ ts: Number(row.ts), value: Number(row.value) }));
}

export async function getAssetAnomalies(
  db: TenantDb,
  assetId: string,
  fromTs = 0,
): Promise<Anomaly[]> {
  // Same bigint-as-string problem as getReadings, for `ts` and for the
  // identity `id`. Both are declared number and both arrive as strings.
  const rows = await db.query<Anomaly>(
    "SELECT * FROM anomalies WHERE tenant_id = $1 AND asset_id = $2 AND ts >= $3 ORDER BY ts DESC",
    [db.tenantId, assetId, fromTs],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), ts: Number(row.ts) }));
}

// --------------------------------------------------------------- work orders

export interface WorkOrderWithJoins extends WorkOrder {
  asset_name: string;
  technician_name: string | null;
}

const WO_SELECT = `SELECT w.*, a.name AS asset_name, t.name AS technician_name
       FROM work_orders w
       JOIN assets a ON a.id = w.asset_id AND a.tenant_id = w.tenant_id
       LEFT JOIN technicians t ON t.id = w.assigned_to AND t.tenant_id = w.tenant_id`;

const WO_ORDER = `ORDER BY CASE w.status WHEN 'closed' THEN 1 ELSE 0 END,
                CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                w.created_at DESC`;

export async function getWorkOrders(
  db: TenantDb,
  status?: string,
): Promise<WorkOrderWithJoins[]> {
  const params: unknown[] = [db.tenantId];
  let where = "WHERE w.tenant_id = $1";
  if (status) {
    where += " AND w.status = $2";
    params.push(status);
  }
  return db.query<WorkOrderWithJoins>(`${WO_SELECT} ${where} ${WO_ORDER}`, params);
}

export async function getWorkOrder(
  db: TenantDb,
  id: string,
): Promise<WorkOrderWithJoins | undefined> {
  const rows = await db.query<WorkOrderWithJoins>(
    `${WO_SELECT} WHERE w.tenant_id = $1 AND w.id = $2`,
    [db.tenantId, id],
  );
  return rows[0];
}

export interface WorkOrderPart extends Part {
  qty: number;
}

export async function getWorkOrderParts(
  db: TenantDb,
  workOrderId: string,
): Promise<WorkOrderPart[]> {
  return db.query<WorkOrderPart>(
    `SELECT p.*, wp.qty FROM work_order_parts wp
       JOIN parts p ON p.id = wp.part_id AND p.tenant_id = wp.tenant_id
      WHERE wp.tenant_id = $1 AND wp.work_order_id = $2`,
    [db.tenantId, workOrderId],
  );
}

export async function getAssetWorkOrders(
  db: TenantDb,
  assetId: string,
): Promise<WorkOrderWithJoins[]> {
  return db.query<WorkOrderWithJoins>(
    `${WO_SELECT} WHERE w.tenant_id = $1 AND w.asset_id = $2 ORDER BY w.created_at DESC`,
    [db.tenantId, assetId],
  );
}

export interface NewWorkOrder {
  asset_id: string;
  title: string;
  description: string;
  priority: WorkOrderPriority;
  type: WorkOrderType;
  assigned_to: string | null;
  due_at: number | null;
}

export async function createWorkOrder(
  db: TenantDb,
  input: NewWorkOrder,
): Promise<string> {
  // FOR UPDATE IS NOT OPTIONAL HERE, and its absence would be a port-only bug.
  // better-sqlite3 serialises writers, so read-modify-write on meta.wo_seq was
  // implicitly safe. Postgres runs transactions concurrently: without the row
  // lock, two simultaneous calls both read 5 and both create WO-6, and the
  // second INSERT fails on the primary key -- or worse, would not if the id
  // were not a key. withTenant() already wraps this in one transaction, so the
  // lock is held until it commits.
  const seq = await db.query<{ value: string }>(
    "SELECT value FROM meta WHERE tenant_id = $1 AND key = 'wo_seq' FOR UPDATE",
    [db.tenantId],
  );
  const next = Number(seq[0].value) + 1;
  await db.query(
    "UPDATE meta SET value = $1 WHERE tenant_id = $2 AND key = 'wo_seq'",
    [String(next), db.tenantId],
  );
  const id = `WO-${next}`;
  await db.query(
    `INSERT INTO work_orders (tenant_id, id, asset_id, title, description, status, priority, type, assigned_to, created_at, due_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, NULL)`,
    [
      db.tenantId,
      id,
      input.asset_id,
      input.title,
      input.description,
      input.priority,
      input.type,
      input.assigned_to,
      nowSec(),
      input.due_at,
    ],
  );
  return id;
}

// ------------------------------------------------- work-order mutations

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export async function assignWorkOrder(
  db: TenantDb,
  id: string,
  technicianId: string | null,
): Promise<void> {
  await db.query(
    "UPDATE work_orders SET assigned_to = $1 WHERE tenant_id = $2 AND id = $3",
    [technicianId, db.tenantId, id],
  );
}

export async function setWorkOrderStatus(
  db: TenantDb,
  id: string,
  status: WorkOrderStatus,
): Promise<void> {
  const rows = await db.query<{ completed_at: number | null }>(
    "SELECT completed_at FROM work_orders WHERE tenant_id = $1 AND id = $2",
    [db.tenantId, id],
  );
  const completedAt = completionForStatus(
    status,
    nowSec(),
    rows[0]?.completed_at ?? null,
  );
  await db.query(
    "UPDATE work_orders SET status = $1, completed_at = $2 WHERE tenant_id = $3 AND id = $4",
    [status, completedAt, db.tenantId, id],
  );
}

export async function setWorkOrderDueDate(
  db: TenantDb,
  id: string,
  dueAt: number | null,
): Promise<void> {
  await db.query(
    "UPDATE work_orders SET due_at = $1 WHERE tenant_id = $2 AND id = $3",
    [dueAt, db.tenantId, id],
  );
}

/**
 * Attach a part to a work order. If the part is already on the order the
 * quantity is replaced (not stacked), so repeated adds are idempotent.
 */
export async function addWorkOrderPart(
  db: TenantDb,
  workOrderId: string,
  partId: string,
  qty: number,
): Promise<void> {
  const existing = await db.query(
    "SELECT 1 FROM work_order_parts WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = $3 FOR UPDATE",
    [db.tenantId, workOrderId, partId],
  );
  if (existing.length) {
    await db.query(
      "UPDATE work_order_parts SET qty = $1 WHERE tenant_id = $2 AND work_order_id = $3 AND part_id = $4",
      [qty, db.tenantId, workOrderId, partId],
    );
  } else {
    await db.query(
      "INSERT INTO work_order_parts (tenant_id, work_order_id, part_id, qty) VALUES ($1, $2, $3, $4)",
      [db.tenantId, workOrderId, partId, qty],
    );
  }
}

export async function removeWorkOrderPart(
  db: TenantDb,
  workOrderId: string,
  partId: string,
): Promise<void> {
  await db.query(
    "DELETE FROM work_order_parts WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = $3",
    [db.tenantId, workOrderId, partId],
  );
}

export async function getPart(db: TenantDb, id: string): Promise<Part | undefined> {
  const rows = await db.query<Part>(
    "SELECT * FROM parts WHERE tenant_id = $1 AND id = $2",
    [db.tenantId, id],
  );
  return rows[0];
}

// ------------------------------------------------------------------ schedule

export interface ScheduleEntry extends MaintenanceTask {
  asset_name: string;
  asset_location: string;
  technician_name: string | null;
}

const SCHEDULE_SELECT = `SELECT m.*, a.name AS asset_name, a.location AS asset_location,
              t.name AS technician_name
       FROM maintenance_schedule m
       JOIN assets a ON a.id = m.asset_id AND a.tenant_id = m.tenant_id
       LEFT JOIN technicians t ON t.id = m.assigned_to AND t.tenant_id = m.tenant_id`;

export async function getSchedule(db: TenantDb): Promise<ScheduleEntry[]> {
  return db.query<ScheduleEntry>(
    `${SCHEDULE_SELECT} WHERE m.tenant_id = $1 ORDER BY m.next_due`,
    [db.tenantId],
  );
}

export async function getMaintenanceTask(
  db: TenantDb,
  id: string,
): Promise<MaintenanceTask | undefined> {
  const rows = await db.query<MaintenanceTask>(
    "SELECT * FROM maintenance_schedule WHERE tenant_id = $1 AND id = $2",
    [db.tenantId, id],
  );
  return rows[0];
}

/** Reschedule a preventive task to a new due date (YYYY-MM-DD). */
export async function rescheduleTask(
  db: TenantDb,
  id: string,
  nextDue: string,
): Promise<void> {
  await db.query(
    "UPDATE maintenance_schedule SET next_due = $1 WHERE tenant_id = $2 AND id = $3",
    [nextDue, db.tenantId, id],
  );
}

export async function getAssetSchedule(
  db: TenantDb,
  assetId: string,
): Promise<ScheduleEntry[]> {
  return db.query<ScheduleEntry>(
    `${SCHEDULE_SELECT} WHERE m.tenant_id = $1 AND m.asset_id = $2 ORDER BY m.next_due`,
    [db.tenantId, assetId],
  );
}

// --------------------------------------------------------------- parts, team

export async function getParts(db: TenantDb): Promise<Part[]> {
  return db.query<Part>(
    `SELECT * FROM parts WHERE tenant_id = $1
      ORDER BY CASE WHEN qty_on_hand < reorder_point THEN 0 ELSE 1 END, category, name`,
    [db.tenantId],
  );
}

export interface TechnicianWithLoad extends Technician {
  open_orders: number;
}

/**
 * Looks up a single technician by id. Used to validate `assigned_to`
 * before a write (D-012 follow-up): the column has no FK, so both write
 * routes call this to reject an unknown id rather than trusting the
 * caller (deep-verify PR #24 blocker B1 -- arbitrary text in
 * `assigned_to` was reaching a fresh visitor's page source).
 */
export async function getTechnician(
  db: TenantDb,
  id: string,
): Promise<Technician | undefined> {
  const rows = await db.query<Technician>(
    "SELECT * FROM technicians WHERE tenant_id = $1 AND id = $2",
    [db.tenantId, id],
  );
  return rows[0];
}

export async function getTechnicians(db: TenantDb): Promise<TechnicianWithLoad[]> {
  return db.query<TechnicianWithLoad>(
    `SELECT t.*, (
         SELECT COUNT(*)::int FROM work_orders w
          WHERE w.tenant_id = t.tenant_id AND w.assigned_to = t.id AND w.status <> 'closed'
       ) AS open_orders
       FROM technicians t WHERE t.tenant_id = $1 ORDER BY t.name`,
    [db.tenantId],
  );
}

// ----------------------------------------------------- purchase orders

export interface PurchaseOrderSummary extends PurchaseOrder {
  line_count: number;
  total: number;
}

export async function getPurchaseOrders(
  db: TenantDb,
): Promise<PurchaseOrderSummary[]> {
  // GROUP BY po.tenant_id, po.id -- NOT po.id alone. Postgres permits SELECT
  // po.* alongside a GROUP BY only when the grouped columns are the table's
  // PRIMARY KEY (functional dependency). D-022 made the key composite, so
  // grouping by id alone now fails outright with "column po.supplier must
  // appear in the GROUP BY clause". A tenancy decision reached in the schema
  // changed what is legal in a query three files away.
  return db.query<PurchaseOrderSummary>(
    `SELECT po.*,
            COUNT(l.part_id)::int AS line_count,
            COALESCE(SUM(l.qty * l.unit_cost), 0) AS total
       FROM purchase_orders po
       LEFT JOIN purchase_order_lines l ON l.po_id = po.id AND l.tenant_id = po.tenant_id
      WHERE po.tenant_id = $1
      GROUP BY po.tenant_id, po.id
      ORDER BY CASE po.status
                 WHEN 'draft' THEN 0 WHEN 'ordered' THEN 1
                 WHEN 'received' THEN 2 ELSE 3 END,
               po.created_at DESC`,
    [db.tenantId],
  );
}

export async function getPurchaseOrder(
  db: TenantDb,
  id: string,
): Promise<PurchaseOrder | undefined> {
  const rows = await db.query<PurchaseOrder>(
    "SELECT * FROM purchase_orders WHERE tenant_id = $1 AND id = $2",
    [db.tenantId, id],
  );
  return rows[0];
}

export interface PurchaseOrderLineWithPart extends PurchaseOrderLine {
  name: string;
  sku: string;
  category: string;
  lead_time_days: number;
}

export async function getPurchaseOrderLines(
  db: TenantDb,
  poId: string,
): Promise<PurchaseOrderLineWithPart[]> {
  return db.query<PurchaseOrderLineWithPart>(
    `SELECT l.*, p.name, p.sku, p.category, p.lead_time_days
       FROM purchase_order_lines l
       JOIN parts p ON p.id = l.part_id AND p.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND l.po_id = $2
      ORDER BY p.category, p.name`,
    [db.tenantId, poId],
  );
}

export async function getBelowReorderParts(db: TenantDb): Promise<Part[]> {
  return db.query<Part>(
    "SELECT * FROM parts WHERE tenant_id = $1 AND qty_on_hand < reorder_point ORDER BY supplier, name",
    [db.tenantId],
  );
}

export interface ReorderResult {
  created: number;
  poIds: string[];
  partCount: number;
}

/**
 * Create draft purchase orders to restock parts. With no partIds, restocks
 * every below-reorder part. Parts are grouped by supplier into one draft PO
 * each, with recommended quantities. Returns what was created.
 */
export async function createReorderPurchaseOrders(
  db: TenantDb,
  partIds?: string[],
): Promise<ReorderResult> {
  let parts: Part[];
  if (partIds && partIds.length) {
    // = ANY($2) rather than an IN list built from placeholders: one bind
    // parameter instead of N, so the statement text does not change with the
    // input and there is no placeholder arithmetic to get wrong.
    parts = await db.query<Part>(
      "SELECT * FROM parts WHERE tenant_id = $1 AND id = ANY($2)",
      [db.tenantId, partIds],
    );
  } else {
    parts = await db.query<Part>(
      "SELECT * FROM parts WHERE tenant_id = $1 AND qty_on_hand < reorder_point",
      [db.tenantId],
    );
  }
  if (!parts.length) return { created: 0, poIds: [], partCount: 0 };

  const bySupplier = new Map<string, Part[]>();
  for (const p of parts) {
    const list = bySupplier.get(p.supplier) ?? [];
    list.push(p);
    bySupplier.set(p.supplier, list);
  }

  // FOR UPDATE, for the same reason as createWorkOrder.
  const seqRow = await db.query<{ value: string }>(
    "SELECT value FROM meta WHERE tenant_id = $1 AND key = 'po_seq' FOR UPDATE",
    [db.tenantId],
  );
  let seq = Number(seqRow[0].value);
  const now = nowSec();
  const poIds: string[] = [];

  for (const [supplier, supplierParts] of bySupplier) {
    seq += 1;
    const id = `PO-${seq}`;
    await db.query(
      `INSERT INTO purchase_orders (tenant_id, id, supplier, status, created_at, ordered_at, expected_at, received_at, notes)
       VALUES ($1, $2, $3, 'draft', $4, NULL, NULL, NULL, $5)`,
      [db.tenantId, id, supplier, now, "Auto-drafted from a reorder alert."],
    );
    for (const p of supplierParts) {
      await db.query(
        "INSERT INTO purchase_order_lines (tenant_id, po_id, part_id, qty, unit_cost) VALUES ($1, $2, $3, $4, $5)",
        [db.tenantId, id, p.id, recommendedReorderQty(p), p.unit_cost],
      );
    }
    poIds.push(id);
  }

  await db.query(
    "UPDATE meta SET value = $1 WHERE tenant_id = $2 AND key = 'po_seq'",
    [String(seq), db.tenantId],
  );
  return { created: poIds.length, poIds, partCount: parts.length };
}

/**
 * Move a purchase order along its lifecycle. Ordering stamps the order date
 * and projects an expected arrival from the longest line lead time. Receiving
 * restocks every line's part against on-hand inventory -- this is the one
 * place stock is incremented, the counterpart to attaching parts to work
 * orders (which deliberately does not touch stock).
 */
export async function setPurchaseOrderStatus(
  db: TenantDb,
  id: string,
  status: PurchaseOrderStatus,
): Promise<void> {
  const t = db.tenantId;
  const now = nowSec();

  if (status === "ordered") {
    const lead = await db.query<{ d: number }>(
      `SELECT COALESCE(MAX(p.lead_time_days), 7)::int AS d
         FROM purchase_order_lines l
         JOIN parts p ON p.id = l.part_id AND p.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.po_id = $2`,
      [t, id],
    );
    await db.query(
      "UPDATE purchase_orders SET status = 'ordered', ordered_at = $1, expected_at = $2 WHERE tenant_id = $3 AND id = $4",
      [now, now + lead[0].d * DAY, t, id],
    );
  } else if (status === "received") {
    const lines = await db.query<{ part_id: string; qty: number }>(
      "SELECT part_id, qty FROM purchase_order_lines WHERE tenant_id = $1 AND po_id = $2",
      [t, id],
    );
    for (const line of lines) {
      await db.query(
        "UPDATE parts SET qty_on_hand = qty_on_hand + $1 WHERE tenant_id = $2 AND id = $3",
        [line.qty, t, line.part_id],
      );
    }
    await db.query(
      "UPDATE purchase_orders SET status = 'received', received_at = $1 WHERE tenant_id = $2 AND id = $3",
      [now, t, id],
    );
  } else {
    await db.query(
      "UPDATE purchase_orders SET status = $1 WHERE tenant_id = $2 AND id = $3",
      [status, t, id],
    );
  }
}

// ----------------------------------------------- part <-> work-order links

export interface WorkOrderConsumingPart extends WorkOrderWithJoins {
  line_qty: number;
}

export async function getPartConsumingWorkOrders(
  db: TenantDb,
  partId: string,
): Promise<WorkOrderConsumingPart[]> {
  return db.query<WorkOrderConsumingPart>(
    `SELECT w.*, a.name AS asset_name, t.name AS technician_name, wp.qty AS line_qty
       FROM work_order_parts wp
       JOIN work_orders w ON w.id = wp.work_order_id AND w.tenant_id = wp.tenant_id
       JOIN assets a ON a.id = w.asset_id AND a.tenant_id = w.tenant_id
       LEFT JOIN technicians t ON t.id = w.assigned_to AND t.tenant_id = w.tenant_id
      WHERE wp.tenant_id = $1 AND wp.part_id = $2
      ORDER BY CASE w.status WHEN 'closed' THEN 1 ELSE 0 END, w.created_at DESC`,
    [db.tenantId, partId],
  );
}

export async function getPartPurchaseOrders(
  db: TenantDb,
  partId: string,
): Promise<PurchaseOrderSummary[]> {
  return db.query<PurchaseOrderSummary>(
    `SELECT po.*, COUNT(l2.part_id)::int AS line_count,
            COALESCE(SUM(l2.qty * l2.unit_cost), 0) AS total
       FROM purchase_orders po
       JOIN purchase_order_lines l
         ON l.po_id = po.id AND l.tenant_id = po.tenant_id AND l.part_id = $2
       LEFT JOIN purchase_order_lines l2 ON l2.po_id = po.id AND l2.tenant_id = po.tenant_id
      WHERE po.tenant_id = $1
      GROUP BY po.tenant_id, po.id
      ORDER BY po.created_at DESC`,
    [db.tenantId, partId],
  );
}

// ------------------------------------------------------------------- reports

export async function getWoMonthlyThroughput(db: TenantDb): Promise<
  {
    month: string;
    opened: number;
    closed: number;
  }[]
> {
  // strftime('%Y-%m', created_at, 'unixepoch') has no Postgres equivalent.
  // to_timestamp() takes epoch seconds and to_char() formats it. The column is
  // bigint, which to_timestamp accepts directly.
  const opened = await db.query<{ month: string; c: number }>(
    `SELECT to_char(to_timestamp(created_at), 'YYYY-MM') AS month, COUNT(*)::int c
       FROM work_orders WHERE tenant_id = $1
      GROUP BY 1`,
    [db.tenantId],
  );
  const closed = await db.query<{ month: string; c: number }>(
    `SELECT to_char(to_timestamp(completed_at), 'YYYY-MM') AS month, COUNT(*)::int c
       FROM work_orders WHERE tenant_id = $1 AND completed_at IS NOT NULL
      GROUP BY 1`,
    [db.tenantId],
  );
  const months = [...new Set([...opened, ...closed].map((r) => r.month))]
    .filter(Boolean)
    .sort();
  return months.map((month) => ({
    month,
    opened: opened.find((r) => r.month === month)?.c ?? 0,
    closed: closed.find((r) => r.month === month)?.c ?? 0,
  }));
}

export async function getAnomaliesBySensor(
  db: TenantDb,
): Promise<{ sensor_type: string; c: number }[]> {
  return db.query<{ sensor_type: string; c: number }>(
    `SELECT sensor_type, COUNT(*)::int c FROM anomalies WHERE tenant_id = $1
      GROUP BY sensor_type ORDER BY c DESC`,
    [db.tenantId],
  );
}

export async function getAnomaliesByDay(
  db: TenantDb,
  days = 30,
): Promise<{ day: string; c: number }[]> {
  const now = await getGeneratedAt(db);
  // The SQLite version grouped by one expression and ORDERED BY the ungrouped
  // `ts` column, which SQLite tolerates and Postgres rejects. Grouping by the
  // full date and ordering by that same value keeps the intended chronological
  // order without referencing an ungrouped column.
  return db.query<{ day: string; c: number }>(
    `SELECT to_char(to_timestamp(ts), 'MM-DD') AS day,
            COUNT(*)::int c
       FROM anomalies
      WHERE tenant_id = $1 AND ts >= $2
      GROUP BY to_char(to_timestamp(ts), 'YYYY-MM-DD'), to_char(to_timestamp(ts), 'MM-DD')
      ORDER BY to_char(to_timestamp(ts), 'YYYY-MM-DD')`,
    [db.tenantId, now - days * DAY],
  );
}

export async function getRiskByLocation(db: TenantDb): Promise<
  {
    location: string;
    avgScore: number;
    assets: number;
  }[]
> {
  // ROUND(double precision, int) DOES NOT EXIST in Postgres -- only
  // ROUND(numeric, int). AVG(risk_score) over a double column is double, so
  // the direct translation is a hard error, not a silent one. ::numeric first,
  // then ::float8 back so the value arrives as a JS number rather than the
  // string node-postgres returns for numeric.
  // "avgScore" is quoted for the same reason as "maxScore" above.
  return db.query<{ location: string; avgScore: number; assets: number }>(
    `SELECT location,
            ROUND(AVG(risk_score)::numeric, 1)::float8 AS "avgScore",
            COUNT(*)::int AS assets
       FROM assets WHERE tenant_id = $1
      GROUP BY location ORDER BY "avgScore" DESC`,
    [db.tenantId],
  );
}

export async function getPartsSpendByCategory(
  db: TenantDb,
): Promise<{ category: string; spend: number }[]> {
  return db.query<{ category: string; spend: number }>(
    `SELECT p.category, ROUND(SUM(p.unit_cost * wp.qty)::numeric)::float8 AS spend
       FROM work_order_parts wp
       JOIN parts p ON p.id = wp.part_id AND p.tenant_id = wp.tenant_id
      WHERE wp.tenant_id = $1
      GROUP BY p.category ORDER BY spend DESC`,
    [db.tenantId],
  );
}

export async function getWoByTypeAndStatus(db: TenantDb): Promise<
  {
    type: string;
    status: string;
    c: number;
  }[]
> {
  return db.query<{ type: string; status: string; c: number }>(
    "SELECT type, status, COUNT(*)::int c FROM work_orders WHERE tenant_id = $1 GROUP BY type, status",
    [db.tenantId],
  );
}
