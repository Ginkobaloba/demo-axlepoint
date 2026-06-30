export type AssetType = "engine" | "generator" | "compressor" | "pump" | "motor";

export type AssetStatus = "operational" | "degraded" | "maintenance" | "offline";

export type Criticality = "standard" | "important" | "critical";

export type RiskBand = "low" | "medium" | "high" | "critical";

export type SensorType =
  | "vibration"
  | "temperature"
  | "oil_pressure"
  | "cylinder_pressure"
  | "rpm"
  | "fuel_rate";

export type AnomalySeverity = "minor" | "major" | "severe";

export type WorkOrderStatus = "open" | "in_progress" | "awaiting_parts" | "closed";

export type WorkOrderPriority = "low" | "medium" | "high" | "urgent";

export type WorkOrderType = "corrective" | "preventive" | "inspection" | "predictive";

export interface RiskFactor {
  sensor: SensorType;
  label: string;
  contribution: number;
  anomalies7d: number;
  trendPct7d: number;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  model: string;
  serial: string;
  location: string;
  installed_on: string;
  run_hours: number;
  status: AssetStatus;
  criticality: Criticality;
  risk_score: number;
  risk_band: RiskBand;
  risk_factors: string; // JSON-encoded RiskFactor[]
}

export interface SensorReading {
  asset_id: string;
  sensor_type: SensorType;
  ts: number;
  value: number;
}

export interface Anomaly {
  id: number;
  asset_id: string;
  sensor_type: SensorType;
  ts: number;
  value: number;
  z_score: number;
  severity: AnomalySeverity;
  note: string;
}

export interface WorkOrder {
  id: string;
  asset_id: string;
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  type: WorkOrderType;
  assigned_to: string | null;
  created_at: number;
  due_at: number | null;
  completed_at: number | null;
}

export interface Part {
  id: string;
  sku: string;
  name: string;
  category: string;
  qty_on_hand: number;
  reorder_point: number;
  unit_cost: number;
  lead_time_days: number;
  supplier: string;
}

export interface Technician {
  id: string;
  name: string;
  role: string;
  location: string;
  certifications: string; // JSON-encoded string[]
  phone: string;
  email: string;
  hired_on: string;
}

export type PurchaseOrderStatus = "draft" | "ordered" | "received" | "cancelled";

export interface PurchaseOrder {
  id: string;
  supplier: string;
  status: PurchaseOrderStatus;
  created_at: number;
  ordered_at: number | null;
  expected_at: number | null;
  received_at: number | null;
  notes: string | null;
}

export interface PurchaseOrderLine {
  po_id: string;
  part_id: string;
  qty: number;
  unit_cost: number; // snapshot at PO creation
}

export interface MaintenanceTask {
  id: string;
  asset_id: string;
  task: string;
  interval_days: number;
  next_due: string;
  assigned_to: string | null;
  est_hours: number;
}

export const SENSOR_LABELS: Record<SensorType, string> = {
  vibration: "Vibration",
  temperature: "Temperature",
  oil_pressure: "Oil pressure",
  cylinder_pressure: "Cylinder pressure",
  rpm: "Shaft speed",
  fuel_rate: "Fuel consumption",
};

export const SENSOR_UNITS: Record<SensorType, string> = {
  vibration: "mm/s",
  temperature: "deg C",
  oil_pressure: "psi",
  cylinder_pressure: "bar",
  rpm: "rpm",
  fuel_rate: "L/h",
};

export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_parts: "Awaiting parts",
  closed: "Closed",
};

export const WO_TYPE_LABELS: Record<WorkOrderType, string> = {
  corrective: "Corrective",
  preventive: "Preventive",
  inspection: "Inspection",
  predictive: "Predictive",
};

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  received: "Received",
  cancelled: "Cancelled",
};

export function riskBand(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
