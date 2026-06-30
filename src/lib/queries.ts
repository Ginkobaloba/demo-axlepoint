import { getDb } from "./db";
import { completionForStatus } from "./wo-actions";
import type {
  Anomaly,
  Asset,
  MaintenanceTask,
  Part,
  SensorType,
  Technician,
  WorkOrder,
  WorkOrderPriority,
  WorkOrderStatus,
  WorkOrderType,
} from "./types";

const DAY = 86400;

export function getGeneratedAt(): number {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = 'generated_at'")
    .get() as { value: string };
  return Number(row.value);
}

// ----------------------------------------------------------------- dashboard

export interface Kpis {
  assetsMonitored: number;
  criticalAssets: number;
  openWorkOrders: number;
  mtbfHours: number;
  mtbfDeltaPct: number;
}

export function getKpis(): Kpis {
  const db = getDb();
  const now = getGeneratedAt();
  const assetsMonitored = (
    db.prepare("SELECT COUNT(*) c FROM assets").get() as { c: number }
  ).c;
  const criticalAssets = (
    db
      .prepare("SELECT COUNT(*) c FROM assets WHERE risk_band = 'critical'")
      .get() as { c: number }
  ).c;
  const openWorkOrders = (
    db
      .prepare("SELECT COUNT(*) c FROM work_orders WHERE status != 'closed'")
      .get() as { c: number }
  ).c;

  // Fleet MTBF proxy: fleet operating hours divided by unplanned-failure
  // work orders (corrective) raised in the window, trailing 30 days vs the
  // 30 days before that.
  const failures = (from: number, to: number) =>
    (
      db
        .prepare(
          "SELECT COUNT(*) c FROM work_orders WHERE type = 'corrective' AND created_at >= ? AND created_at < ?",
        )
        .get(from, to) as { c: number }
    ).c;
  const fleetHours = assetsMonitored * 30 * 24;
  const recent = Math.max(1, failures(now - 30 * DAY, now));
  const prior = Math.max(1, failures(now - 60 * DAY, now - 30 * DAY));
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

export function getTopRiskAssets(limit = 10): Asset[] {
  return getDb()
    .prepare("SELECT * FROM assets ORDER BY risk_score DESC LIMIT ?")
    .all(limit) as Asset[];
}

export interface AnomalyWithAsset extends Anomaly {
  asset_name: string;
  asset_location: string;
}

export function getRecentAnomalies(limit = 12): AnomalyWithAsset[] {
  return getDb()
    .prepare(
      `SELECT a.*, s.name AS asset_name, s.location AS asset_location
       FROM anomalies a JOIN assets s ON s.id = a.asset_id
       ORDER BY a.ts DESC LIMIT ?`,
    )
    .all(limit) as AnomalyWithAsset[];
}

export function getRiskBandCounts(): { risk_band: string; c: number }[] {
  return getDb()
    .prepare("SELECT risk_band, COUNT(*) c FROM assets GROUP BY risk_band")
    .all() as { risk_band: string; c: number }[];
}

export function getLocationRiskMatrix(): {
  location: string;
  type: string;
  c: number;
  maxScore: number;
}[] {
  return getDb()
    .prepare(
      `SELECT location, type, COUNT(*) c, MAX(risk_score) maxScore
       FROM assets GROUP BY location, type`,
    )
    .all() as { location: string; type: string; c: number; maxScore: number }[];
}

// -------------------------------------------------------------------- assets

export interface AssetFilters {
  q?: string;
  type?: string;
  location?: string;
  band?: string;
}

export function getAssets(filters: AssetFilters = {}): Asset[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.q) {
    clauses.push("(id LIKE ? OR name LIKE ? OR model LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  if (filters.type) {
    clauses.push("type = ?");
    params.push(filters.type);
  }
  if (filters.location) {
    clauses.push("location = ?");
    params.push(filters.location);
  }
  if (filters.band) {
    clauses.push("risk_band = ?");
    params.push(filters.band);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM assets ${where} ORDER BY risk_score DESC, id`)
    .all(...params) as Asset[];
}

export function getAsset(id: string): Asset | undefined {
  return getDb().prepare("SELECT * FROM assets WHERE id = ?").get(id) as
    | Asset
    | undefined;
}

export function getLocations(): string[] {
  return (
    getDb()
      .prepare("SELECT DISTINCT location FROM assets ORDER BY location")
      .all() as { location: string }[]
  ).map((r) => r.location);
}

export function getAssetSensors(assetId: string): SensorType[] {
  return (
    getDb()
      .prepare(
        "SELECT DISTINCT sensor_type FROM sensor_readings WHERE asset_id = ?",
      )
      .all(assetId) as { sensor_type: SensorType }[]
  ).map((r) => r.sensor_type);
}

export function getReadings(
  assetId: string,
  sensor: SensorType,
  fromTs: number,
): { ts: number; value: number }[] {
  return getDb()
    .prepare(
      `SELECT ts, value FROM sensor_readings
       WHERE asset_id = ? AND sensor_type = ? AND ts >= ?
       ORDER BY ts`,
    )
    .all(assetId, sensor, fromTs) as { ts: number; value: number }[];
}

export function getAssetAnomalies(
  assetId: string,
  fromTs = 0,
): Anomaly[] {
  return getDb()
    .prepare(
      "SELECT * FROM anomalies WHERE asset_id = ? AND ts >= ? ORDER BY ts DESC",
    )
    .all(assetId, fromTs) as Anomaly[];
}

// --------------------------------------------------------------- work orders

export interface WorkOrderWithJoins extends WorkOrder {
  asset_name: string;
  technician_name: string | null;
}

export function getWorkOrders(status?: string): WorkOrderWithJoins[] {
  const where = status ? "WHERE w.status = ?" : "";
  const params = status ? [status] : [];
  return getDb()
    .prepare(
      `SELECT w.*, a.name AS asset_name, t.name AS technician_name
       FROM work_orders w
       JOIN assets a ON a.id = w.asset_id
       LEFT JOIN technicians t ON t.id = w.assigned_to
       ${where}
       ORDER BY CASE w.status WHEN 'closed' THEN 1 ELSE 0 END,
                CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                w.created_at DESC`,
    )
    .all(...params) as WorkOrderWithJoins[];
}

export function getWorkOrder(id: string): WorkOrderWithJoins | undefined {
  return getDb()
    .prepare(
      `SELECT w.*, a.name AS asset_name, t.name AS technician_name
       FROM work_orders w
       JOIN assets a ON a.id = w.asset_id
       LEFT JOIN technicians t ON t.id = w.assigned_to
       WHERE w.id = ?`,
    )
    .get(id) as WorkOrderWithJoins | undefined;
}

export interface WorkOrderPart extends Part {
  qty: number;
}

export function getWorkOrderParts(workOrderId: string): WorkOrderPart[] {
  return getDb()
    .prepare(
      `SELECT p.*, wp.qty FROM work_order_parts wp
       JOIN parts p ON p.id = wp.part_id WHERE wp.work_order_id = ?`,
    )
    .all(workOrderId) as WorkOrderPart[];
}

export function getAssetWorkOrders(assetId: string): WorkOrderWithJoins[] {
  return getDb()
    .prepare(
      `SELECT w.*, a.name AS asset_name, t.name AS technician_name
       FROM work_orders w
       JOIN assets a ON a.id = w.asset_id
       LEFT JOIN technicians t ON t.id = w.assigned_to
       WHERE w.asset_id = ? ORDER BY w.created_at DESC`,
    )
    .all(assetId) as WorkOrderWithJoins[];
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

export function createWorkOrder(input: NewWorkOrder): string {
  const db = getDb();
  const tx = db.transaction(() => {
    const seqRow = db
      .prepare("SELECT value FROM meta WHERE key = 'wo_seq'")
      .get() as { value: string };
    const next = Number(seqRow.value) + 1;
    db.prepare("UPDATE meta SET value = ? WHERE key = 'wo_seq'").run(
      String(next),
    );
    const id = `WO-${next}`;
    db.prepare(
      `INSERT INTO work_orders (id, asset_id, title, description, status, priority, type, assigned_to, created_at, due_at, completed_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      input.asset_id,
      input.title,
      input.description,
      input.priority,
      input.type,
      input.assigned_to,
      Math.floor(Date.now() / 1000),
      input.due_at,
    );
    return id;
  });
  return tx();
}

// ------------------------------------------------- work-order mutations

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function assignWorkOrder(id: string, technicianId: string | null): void {
  getDb()
    .prepare("UPDATE work_orders SET assigned_to = ? WHERE id = ?")
    .run(technicianId, id);
}

export function setWorkOrderStatus(id: string, status: WorkOrderStatus): void {
  const db = getDb();
  const row = db
    .prepare("SELECT completed_at FROM work_orders WHERE id = ?")
    .get(id) as { completed_at: number | null } | undefined;
  const completedAt = completionForStatus(
    status,
    nowSec(),
    row?.completed_at ?? null,
  );
  db.prepare(
    "UPDATE work_orders SET status = ?, completed_at = ? WHERE id = ?",
  ).run(status, completedAt, id);
}

export function setWorkOrderDueDate(id: string, dueAt: number | null): void {
  getDb()
    .prepare("UPDATE work_orders SET due_at = ? WHERE id = ?")
    .run(dueAt, id);
}

/**
 * Attach a part to a work order. If the part is already on the order the
 * quantity is replaced (not stacked), so repeated adds are idempotent.
 */
export function addWorkOrderPart(
  workOrderId: string,
  partId: string,
  qty: number,
): void {
  const db = getDb();
  db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT 1 FROM work_order_parts WHERE work_order_id = ? AND part_id = ?",
      )
      .get(workOrderId, partId);
    if (existing) {
      db.prepare(
        "UPDATE work_order_parts SET qty = ? WHERE work_order_id = ? AND part_id = ?",
      ).run(qty, workOrderId, partId);
    } else {
      db.prepare(
        "INSERT INTO work_order_parts (work_order_id, part_id, qty) VALUES (?, ?, ?)",
      ).run(workOrderId, partId, qty);
    }
  })();
}

export function removeWorkOrderPart(workOrderId: string, partId: string): void {
  getDb()
    .prepare(
      "DELETE FROM work_order_parts WHERE work_order_id = ? AND part_id = ?",
    )
    .run(workOrderId, partId);
}

export function getPart(id: string): Part | undefined {
  return getDb().prepare("SELECT * FROM parts WHERE id = ?").get(id) as
    | Part
    | undefined;
}

// ------------------------------------------------------------------ schedule

export interface ScheduleEntry extends MaintenanceTask {
  asset_name: string;
  asset_location: string;
  technician_name: string | null;
}

export function getSchedule(): ScheduleEntry[] {
  return getDb()
    .prepare(
      `SELECT m.*, a.name AS asset_name, a.location AS asset_location,
              t.name AS technician_name
       FROM maintenance_schedule m
       JOIN assets a ON a.id = m.asset_id
       LEFT JOIN technicians t ON t.id = m.assigned_to
       ORDER BY m.next_due`,
    )
    .all() as ScheduleEntry[];
}

export function getAssetSchedule(assetId: string): ScheduleEntry[] {
  return getDb()
    .prepare(
      `SELECT m.*, a.name AS asset_name, a.location AS asset_location,
              t.name AS technician_name
       FROM maintenance_schedule m
       JOIN assets a ON a.id = m.asset_id
       LEFT JOIN technicians t ON t.id = m.assigned_to
       WHERE m.asset_id = ? ORDER BY m.next_due`,
    )
    .all(assetId) as ScheduleEntry[];
}

// --------------------------------------------------------------- parts, team

export function getParts(): Part[] {
  return getDb()
    .prepare(
      `SELECT * FROM parts
       ORDER BY CASE WHEN qty_on_hand < reorder_point THEN 0 ELSE 1 END, category, name`,
    )
    .all() as Part[];
}

export interface TechnicianWithLoad extends Technician {
  open_orders: number;
}

export function getTechnicians(): TechnicianWithLoad[] {
  return getDb()
    .prepare(
      `SELECT t.*, (
         SELECT COUNT(*) FROM work_orders w
         WHERE w.assigned_to = t.id AND w.status != 'closed'
       ) AS open_orders
       FROM technicians t ORDER BY t.name`,
    )
    .all() as TechnicianWithLoad[];
}

// ------------------------------------------------------------------- reports

export function getWoMonthlyThroughput(): {
  month: string;
  opened: number;
  closed: number;
}[] {
  const db = getDb();
  const opened = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at, 'unixepoch') month, COUNT(*) c
       FROM work_orders GROUP BY month`,
    )
    .all() as { month: string; c: number }[];
  const closed = db
    .prepare(
      `SELECT strftime('%Y-%m', completed_at, 'unixepoch') month, COUNT(*) c
       FROM work_orders WHERE completed_at IS NOT NULL GROUP BY month`,
    )
    .all() as { month: string; c: number }[];
  const months = [...new Set([...opened, ...closed].map((r) => r.month))]
    .filter(Boolean)
    .sort();
  return months.map((month) => ({
    month,
    opened: opened.find((r) => r.month === month)?.c ?? 0,
    closed: closed.find((r) => r.month === month)?.c ?? 0,
  }));
}

export function getAnomaliesBySensor(): { sensor_type: string; c: number }[] {
  return getDb()
    .prepare(
      "SELECT sensor_type, COUNT(*) c FROM anomalies GROUP BY sensor_type ORDER BY c DESC",
    )
    .all() as { sensor_type: string; c: number }[];
}

export function getAnomaliesByDay(days = 30): { day: string; c: number }[] {
  const now = getGeneratedAt();
  return getDb()
    .prepare(
      `SELECT strftime('%m-%d', ts, 'unixepoch') day, COUNT(*) c
       FROM anomalies WHERE ts >= ? GROUP BY strftime('%Y-%m-%d', ts, 'unixepoch') ORDER BY ts`,
    )
    .all(now - days * DAY) as { day: string; c: number }[];
}

export function getRiskByLocation(): {
  location: string;
  avgScore: number;
  assets: number;
}[] {
  return getDb()
    .prepare(
      `SELECT location, ROUND(AVG(risk_score), 1) avgScore, COUNT(*) assets
       FROM assets GROUP BY location ORDER BY avgScore DESC`,
    )
    .all() as { location: string; avgScore: number; assets: number }[];
}

export function getPartsSpendByCategory(): { category: string; spend: number }[] {
  return getDb()
    .prepare(
      `SELECT p.category, ROUND(SUM(p.unit_cost * wp.qty)) spend
       FROM work_order_parts wp JOIN parts p ON p.id = wp.part_id
       GROUP BY p.category ORDER BY spend DESC`,
    )
    .all() as { category: string; spend: number }[];
}

export function getWoByTypeAndStatus(): {
  type: string;
  status: string;
  c: number;
}[] {
  return getDb()
    .prepare(
      "SELECT type, status, COUNT(*) c FROM work_orders GROUP BY type, status",
    )
    .all() as { type: string; status: string; c: number }[];
}
