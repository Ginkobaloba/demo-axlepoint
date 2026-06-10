/**
 * AxlePoint synthetic data generator.
 *
 * Builds data/axlepoint.db from scratch: 100 assets across 8 sites,
 * ~6 months of sensor history per asset (hourly for the trailing 14 days,
 * 6-hourly before that), anomalies detected with the same EWMA z-score
 * detector the UI uses, risk scores, 150 work orders, 80 parts,
 * 15 technicians, and a 45-day preventive maintenance schedule.
 *
 * Everything is seeded and deterministic except the time anchor, which is
 * the generation timestamp rounded to the hour.
 *
 * All data is synthetic. Sites, models, suppliers, and people are fictional.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Rng } from "../src/lib/rng";
import {
  initState,
  scoreAndUpdate,
  severityForZ,
  windowTrendPct,
  Z_THRESHOLD,
} from "../src/lib/anomaly";
import { computeRisk, type SensorActivity } from "../src/lib/risk";
import {
  SENSOR_LABELS,
  SENSOR_UNITS,
  type AnomalySeverity,
  type AssetType,
  type SensorType,
} from "../src/lib/types";

const OUT_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(OUT_DIR, "axlepoint.db");

const rng = new Rng(0x41584c45); // "AXLE"

// ---------------------------------------------------------------- time grid

const HOUR = 3600;
const nowTs = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
const DAYS_TOTAL = 183;
const DAYS_HOURLY = 14;
const startTs = nowTs - DAYS_TOTAL * 24 * HOUR;
const hourlyStartTs = nowTs - DAYS_HOURLY * 24 * HOUR;

const timestamps: number[] = [];
for (let ts = startTs; ts < hourlyStartTs; ts += 6 * HOUR) timestamps.push(ts);
for (let ts = hourlyStartTs; ts <= nowTs; ts += HOUR) timestamps.push(ts);

// ---------------------------------------------------------------- catalogs

const LOCATIONS = [
  "Lake Erie Power Station",
  "Galveston Marine Yard",
  "Tucson Mining Site 4",
  "Norfolk Naval Maintenance Depot",
  "Bakken Pump Station 12",
  "Pittsburgh Generating",
  "San Pedro Port Maintenance",
  "Buffalo Distribution Center",
] as const;

const MODELS: Record<AssetType, string[]> = {
  engine: ["Meridian V12T", "Caldera C16V", "Borealis 900M", "Titanline T8"],
  generator: ["Voltaic G2500", "Voltaic G1800", "Dynaspan D40"],
  compressor: ["AeroCore AC-340", "AeroCore AC-520"],
  pump: ["HydraFlow HP-90", "HydraFlow HP-140"],
  motor: ["Torquex M450"],
};

const SENSORS_BY_TYPE: Record<AssetType, SensorType[]> = {
  engine: [
    "vibration",
    "temperature",
    "oil_pressure",
    "cylinder_pressure",
    "rpm",
    "fuel_rate",
  ],
  generator: ["vibration", "temperature", "oil_pressure", "rpm", "fuel_rate"],
  compressor: ["vibration", "temperature", "oil_pressure", "rpm"],
  pump: ["vibration", "temperature", "oil_pressure", "rpm"],
  motor: ["vibration", "temperature", "rpm"],
};

interface SensorProfile {
  base: number;
  noiseSd: number; // as fraction of base
  dailyAmp: number; // as fraction of base
}

const PROFILES: Record<AssetType, Partial<Record<SensorType, SensorProfile>>> =
  {
    engine: {
      vibration: { base: 2.4, noiseSd: 0.05, dailyAmp: 0.006 },
      temperature: { base: 82, noiseSd: 0.022, dailyAmp: 0.015 },
      oil_pressure: { base: 58, noiseSd: 0.03, dailyAmp: 0.005 },
      cylinder_pressure: { base: 112, noiseSd: 0.02, dailyAmp: 0.004 },
      rpm: { base: 720, noiseSd: 0.008, dailyAmp: 0.002 },
      fuel_rate: { base: 185, noiseSd: 0.04, dailyAmp: 0.03 },
    },
    generator: {
      vibration: { base: 1.8, noiseSd: 0.05, dailyAmp: 0.006 },
      temperature: { base: 74, noiseSd: 0.022, dailyAmp: 0.018 },
      oil_pressure: { base: 52, noiseSd: 0.03, dailyAmp: 0.005 },
      rpm: { base: 1800, noiseSd: 0.006, dailyAmp: 0.002 },
      fuel_rate: { base: 118, noiseSd: 0.04, dailyAmp: 0.03 },
    },
    compressor: {
      vibration: { base: 2.8, noiseSd: 0.055, dailyAmp: 0.006 },
      temperature: { base: 96, noiseSd: 0.025, dailyAmp: 0.014 },
      oil_pressure: { base: 62, noiseSd: 0.03, dailyAmp: 0.005 },
      rpm: { base: 2950, noiseSd: 0.007, dailyAmp: 0.002 },
    },
    pump: {
      vibration: { base: 2.1, noiseSd: 0.05, dailyAmp: 0.006 },
      temperature: { base: 64, noiseSd: 0.025, dailyAmp: 0.016 },
      oil_pressure: { base: 47, noiseSd: 0.03, dailyAmp: 0.005 },
      rpm: { base: 1750, noiseSd: 0.007, dailyAmp: 0.002 },
    },
    motor: {
      vibration: { base: 1.4, noiseSd: 0.05, dailyAmp: 0.006 },
      temperature: { base: 71, noiseSd: 0.025, dailyAmp: 0.018 },
      rpm: { base: 1780, noiseSd: 0.006, dailyAmp: 0.002 },
    },
  };

// --------------------------------------------------------- asset population

interface AssetSeed {
  id: string;
  name: string;
  type: AssetType;
  model: string;
  serial: string;
  location: string;
  installed_on: string;
  run_hours: number;
  criticality: string;
}

const TYPE_COUNTS: [AssetType, number][] = [
  ["engine", 60],
  ["generator", 20],
  ["compressor", 10],
  ["pump", 7],
  ["motor", 3],
];

function serial(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let s = "SN-";
  for (let i = 0; i < 8; i++) s += chars[rng.int(0, chars.length - 1)];
  return s;
}

const assets: AssetSeed[] = [];
{
  let seq = 0;
  for (const [type, count] of TYPE_COUNTS) {
    for (let i = 1; i <= count; i++) {
      seq += 1;
      const installYear = rng.int(2008, 2023);
      const installMonth = rng.int(1, 12);
      assets.push({
        id: `AST-${String(seq).padStart(4, "0")}`,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${String(i).padStart(2, "0")}`,
        type,
        model: rng.pick(MODELS[type]),
        serial: serial(),
        location: rng.pick(LOCATIONS),
        installed_on: `${installYear}-${String(installMonth).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
        run_hours: rng.int(8000, 96000),
        criticality: rng.pick([
          "standard",
          "standard",
          "standard",
          "important",
          "important",
          "critical",
        ] as const),
      });
    }
  }
}

// ------------------------------------------------- degradation assignments

type Tier = "critical" | "high" | "medium";

interface Degradation {
  tier: Tier;
  sensors: SensorType[];
  driftPct: number; // total ramp over the drift window, applied to ramped sensors
  driftDays: number;
  spikeP: number; // per-reading transient spike probability in last 7 days
  bursts: number; // sustained offset events in the last 5 days
}

const degradation = new Map<string, Degradation>();
{
  // Spread the interesting assets across types and sites: shuffle, then
  // assign tiers. Engines are over-represented on purpose (60% of fleet).
  const shuffled = rng.shuffle(assets.map((a) => a.id));
  const tiers: [Tier, number][] = [
    ["critical", 4],
    ["high", 7],
    ["medium", 14],
  ];
  let idx = 0;
  for (const [tier, n] of tiers) {
    for (let i = 0; i < n; i++) {
      const id = shuffled[idx++];
      const asset = assets.find((a) => a.id === id)!;
      const available = SENSORS_BY_TYPE[asset.type].filter(
        (s) => s !== "rpm",
      );
      const primary = rng.pick(
        available.filter((s) => s === "vibration" || s === "temperature"),
      );
      const secondary = rng.pick(available.filter((s) => s !== primary));
      degradation.set(id, {
        tier,
        sensors:
          tier === "critical" ? [primary, secondary] : [primary],
        driftPct:
          tier === "critical"
            ? rng.float(0.26, 0.38)
            : tier === "high"
              ? rng.float(0.18, 0.28)
              : rng.float(0.1, 0.16),
        driftDays:
          tier === "critical" ? rng.int(10, 16) : rng.int(6, 12),
        spikeP:
          tier === "critical" ? 0.045 : tier === "high" ? 0.04 : 0.03,
        bursts: tier === "critical" ? 2 : tier === "high" ? 1 : 0,
      });
    }
  }
}

// ---------------------------------------------------------------- database

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(OUT_PATH, { force: true });
fs.rmSync(`${OUT_PATH}-wal`, { force: true });
fs.rmSync(`${OUT_PATH}-shm`, { force: true });

const db = new Database(OUT_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");

db.exec(`
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  model TEXT NOT NULL,
  serial TEXT NOT NULL,
  location TEXT NOT NULL,
  installed_on TEXT NOT NULL,
  run_hours INTEGER NOT NULL,
  status TEXT NOT NULL,
  criticality TEXT NOT NULL,
  risk_score REAL NOT NULL,
  risk_band TEXT NOT NULL,
  risk_factors TEXT NOT NULL
);

CREATE TABLE sensor_readings (
  asset_id TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX idx_readings ON sensor_readings(asset_id, sensor_type, ts);

CREATE TABLE anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL,
  z_score REAL NOT NULL,
  severity TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE INDEX idx_anomalies_asset ON anomalies(asset_id, ts);
CREATE INDEX idx_anomalies_ts ON anomalies(ts);

CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  type TEXT NOT NULL,
  assigned_to TEXT,
  created_at INTEGER NOT NULL,
  due_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX idx_wo_asset ON work_orders(asset_id);
CREATE INDEX idx_wo_status ON work_orders(status);

CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  qty_on_hand INTEGER NOT NULL,
  reorder_point INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  lead_time_days INTEGER NOT NULL,
  supplier TEXT NOT NULL
);

CREATE TABLE work_order_parts (
  work_order_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  qty INTEGER NOT NULL
);

CREATE TABLE technicians (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL,
  certifications TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  hired_on TEXT NOT NULL
);

CREATE TABLE maintenance_schedule (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  task TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  next_due TEXT NOT NULL,
  assigned_to TEXT,
  est_hours REAL NOT NULL
);
`);

// ------------------------------------------------ readings + anomaly pass

const insertReading = db.prepare(
  "INSERT INTO sensor_readings (asset_id, sensor_type, ts, value) VALUES (?, ?, ?, ?)",
);
const insertAnomaly = db.prepare(
  "INSERT INTO anomalies (asset_id, sensor_type, ts, value, z_score, severity, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

interface SeriesResult {
  anomalies7dBySeverity: Record<AnomalySeverity, number>;
  trendPct7d: number;
}

const sevenDaysAgo = nowTs - 7 * 24 * HOUR;

function generateSeries(
  asset: AssetSeed,
  sensor: SensorType,
  deg: Degradation | undefined,
): SeriesResult {
  const profile = PROFILES[asset.type][sensor]!;
  const base = profile.base * rng.float(0.94, 1.06); // unit-to-unit variation
  const noiseSd = base * profile.noiseSd;
  const phase = rng.float(0, 24);

  const drifting = deg?.sensors.includes(sensor) ?? false;
  // Secondary sensors on critical-tier assets degrade at reduced intensity,
  // so the explanation panel shows one dominant driver plus a weaker second.
  const roleFactor = drifting && deg!.sensors[0] !== sensor ? 0.45 : 1;
  const driftStart = deg ? nowTs - deg.driftDays * 24 * HOUR : 0;
  // Oil pressure degrades DOWN; everything else degrades UP.
  const driftSign = sensor === "oil_pressure" ? -1 : 1;

  // Sustained burst windows (sticky offsets) for degrading assets.
  const burstWindows: [number, number, number][] = [];
  if (deg && drifting) {
    for (let b = 0; b < deg.bursts; b++) {
      const burstStart = nowTs - rng.int(12, 110) * HOUR;
      const burstLen = rng.int(5, 10) * HOUR;
      burstWindows.push([
        burstStart,
        burstStart + burstLen,
        rng.float(3.6, 6.0) * noiseSd,
      ]);
    }
  }

  const state = initState();
  const counts: Record<AnomalySeverity, number> = {
    minor: 0,
    major: 0,
    severe: 0,
  };
  const last14d: { value: number }[] = [];

  for (const ts of timestamps) {
    const hourOfDay = ((ts / HOUR) % 24) + phase;
    let value =
      base *
        (1 + profile.dailyAmp * Math.sin((2 * Math.PI * hourOfDay) / 24)) +
      rng.gaussian(0, noiseSd);

    if (drifting && deg && ts > driftStart) {
      const progress = (ts - driftStart) / (nowTs - driftStart);
      value += driftSign * base * deg.driftPct * roleFactor * progress;
    }

    for (const [bStart, bEnd, offset] of burstWindows) {
      if (ts >= bStart && ts < bEnd) value += driftSign * offset;
    }

    // Transient spikes: a fleet-wide background rate, elevated on
    // degrading assets within the last 7 days. Magnitudes are drawn from a
    // half-gaussian above the detection threshold so most hits are minor
    // and severe hits are rare, matching how real exceedances distribute.
    const inLast7d = ts >= sevenDaysAgo;
    const spikeP =
      drifting && deg && inLast7d ? deg.spikeP * roleFactor : 0.0012;
    if (rng.chance(spikeP)) {
      const sigmaSpread = drifting && deg ? 1.1 : 0.6;
      const mag = 3.3 + Math.abs(rng.gaussian(0, sigmaSpread));
      value += driftSign * mag * noiseSd;
    }

    const z = scoreAndUpdate(state, value);
    insertReading.run(asset.id, sensor, ts, Math.round(value * 1000) / 1000);

    if (Math.abs(z) > Z_THRESHOLD) {
      const severity = severityForZ(z);
      if (inLast7d) counts[severity] += 1;
      const note = `${SENSOR_LABELS[sensor]} ${Math.abs(z).toFixed(1)} sigma ${
        z > 0 ? "above" : "below"
      } rolling baseline (${value.toFixed(1)} ${SENSOR_UNITS[sensor]}, expected ~${state.mean.toFixed(1)})`;
      insertAnomaly.run(
        asset.id,
        sensor,
        ts,
        Math.round(value * 1000) / 1000,
        Math.round(z * 100) / 100,
        severity,
        note,
      );
    }

    if (ts >= nowTs - 14 * 24 * HOUR) last14d.push({ value });
  }

  return {
    anomalies7dBySeverity: counts,
    trendPct7d: windowTrendPct(last14d, Math.floor(last14d.length / 2)),
  };
}

console.log(
  `Generating ${timestamps.length} timestamps x ~5 sensors x ${assets.length} assets...`,
);

const insertAsset = db.prepare(`
  INSERT INTO assets (id, name, type, model, serial, location, installed_on,
    run_hours, status, criticality, risk_score, risk_band, risk_factors)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const assetRisk = new Map<string, { score: number; band: string }>();

db.transaction(() => {
  for (const asset of assets) {
    const deg = degradation.get(asset.id);
    const activity: SensorActivity[] = [];
    for (const sensor of SENSORS_BY_TYPE[asset.type]) {
      const result = generateSeries(asset, sensor, deg);
      activity.push({
        sensor,
        counts: result.anomalies7dBySeverity,
        trendPct7d: result.trendPct7d,
      });
    }
    const risk = computeRisk(activity);
    assetRisk.set(asset.id, { score: risk.score, band: risk.band });

    let status = "operational";
    if (risk.band === "critical") status = "degraded";
    else if (risk.band === "high" && rng.chance(0.4)) status = "degraded";

    insertAsset.run(
      asset.id,
      asset.name,
      asset.type,
      asset.model,
      asset.serial,
      asset.location,
      asset.installed_on,
      asset.run_hours,
      status,
      asset.criticality,
      risk.score,
      risk.band,
      JSON.stringify(risk.factors),
    );
  }
})();

// A handful of healthy assets are down for planned maintenance or offline.
{
  const healthy = assets.filter(
    (a) => (assetRisk.get(a.id)?.score ?? 0) < 25,
  );
  const picked = rng.shuffle(healthy.map((a) => a.id)).slice(0, 6);
  const setStatus = db.prepare("UPDATE assets SET status = ? WHERE id = ?");
  picked.forEach((id, i) => setStatus.run(i < 4 ? "maintenance" : "offline", id));
}

// ------------------------------------------------------------- technicians

const TECHNICIANS = [
  ["Marcus Webb", "Lead Technician"],
  ["Elena Vasquez", "Vibration Analyst"],
  ["Dale Kowalski", "Field Technician"],
  ["Priya Raman", "Electrical Specialist"],
  ["Tom Okafor", "Field Technician"],
  ["Sarah Lindqvist", "Planner / Scheduler"],
  ["Ray Castellano", "Field Technician"],
  ["Jin-Ho Park", "Controls Specialist"],
  ["Angela Brooks", "Lead Technician"],
  ["Pete Halvorsen", "Field Technician"],
  ["Naomi Tran", "Reliability Engineer"],
  ["Curtis Boyd", "Field Technician"],
  ["Ilse Hartmann", "Lubrication Specialist"],
  ["Devon McAllister", "Field Technician"],
  ["Rosa Delgado", "Field Technician"],
] as const;

const CERTS = [
  "Vibration Analysis Cat II",
  "Vibration Analysis Cat III",
  "Laser Alignment",
  "NFPA 70E Electrical Safety",
  "MSHA Part 48",
  "ABS Marine Systems",
  "Infrared Thermography Level I",
  "Lubrication Analyst MLA I",
  "Confined Space Entry",
  "Crane & Rigging",
];

const insertTech = db.prepare(`
  INSERT INTO technicians (id, name, role, location, certifications, phone, email, hired_on)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const techIds: string[] = [];
db.transaction(() => {
  TECHNICIANS.forEach(([name, role], i) => {
    const id = `TCH-${String(i + 1).padStart(2, "0")}`;
    techIds.push(id);
    const certs = rng.shuffle([...CERTS]).slice(0, rng.int(2, 4));
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@axlepoint.example`;
    insertTech.run(
      id,
      name,
      role,
      rng.pick(LOCATIONS),
      JSON.stringify(certs),
      `(555) 01${String(rng.int(10, 99))}-${String(rng.int(1000, 9999))}`,
      email,
      `${rng.int(2012, 2025)}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
    );
  });
})();

// ------------------------------------------------------------------- parts

const PART_CATALOG: [string, string, string, number][] = [
  // category, sku prefix, name stem, typical unit cost
  ["Filtration", "FLT", "Oil filter element", 85],
  ["Filtration", "FLT", "Fuel filter cartridge", 64],
  ["Filtration", "FLT", "Air intake filter", 142],
  ["Filtration", "FLT", "Coolant filter", 58],
  ["Bearings & Seals", "BRG", "Main bearing set", 2400],
  ["Bearings & Seals", "BRG", "Thrust bearing", 1850],
  ["Bearings & Seals", "BRG", "Roller bearing", 420],
  ["Bearings & Seals", "BRG", "Mechanical seal", 660],
  ["Bearings & Seals", "BRG", "Shaft seal kit", 310],
  ["Gaskets", "GSK", "Head gasket set", 940],
  ["Gaskets", "GSK", "Exhaust manifold gasket", 180],
  ["Gaskets", "GSK", "Valve cover gasket", 95],
  ["Lubricants", "LUB", "Synthetic engine oil (208L drum)", 1450],
  ["Lubricants", "LUB", "Bearing grease (18kg pail)", 240],
  ["Lubricants", "LUB", "Hydraulic fluid (208L drum)", 1180],
  ["Electrical", "ELC", "Stator winding kit", 5200],
  ["Electrical", "ELC", "Brushless exciter assembly", 3800],
  ["Electrical", "ELC", "Motor contactor", 480],
  ["Electrical", "ELC", "Cable termination kit", 150],
  ["Instrumentation", "INS", "Vibration probe", 890],
  ["Instrumentation", "INS", "RTD temperature sensor", 215],
  ["Instrumentation", "INS", "Pressure transmitter", 720],
  ["Instrumentation", "INS", "Proximity sensor", 540],
  ["Fuel System", "FUE", "Fuel injector", 1250],
  ["Fuel System", "FUE", "Injection pump rebuild kit", 2900],
  ["Fuel System", "FUE", "Fuel line assembly", 340],
  ["Cooling", "COO", "Heat exchanger core", 4600],
  ["Cooling", "COO", "Coolant pump", 1750],
  ["Cooling", "COO", "Thermostat assembly", 165],
  ["Cooling", "COO", "Radiator fan blade", 380],
  ["Valves & Actuators", "VLV", "Intake valve set", 1120],
  ["Valves & Actuators", "VLV", "Exhaust valve set", 1340],
  ["Valves & Actuators", "VLV", "Relief valve", 290],
  ["Valves & Actuators", "VLV", "Pneumatic actuator", 860],
  ["Fasteners", "FST", "Head bolt kit", 220],
  ["Fasteners", "FST", "Coupling bolt set", 130],
  ["Turbocharger", "TRB", "Turbocharger cartridge", 6800],
  ["Turbocharger", "TRB", "Wastegate actuator", 540],
  ["Exhaust", "EXH", "Expansion joint", 760],
  ["Exhaust", "EXH", "Silencer packing kit", 410],
];

const SUPPLIERS = [
  "Meridian Bearing Co",
  "Halverson Industrial Supply",
  "Great Lakes Filtration",
  "Apex Seal & Gasket",
  "Northstar Lubricants",
  "Cascade Controls",
  "Ironclad Fasteners",
  "Beacon Power Components",
];

const insertPart = db.prepare(`
  INSERT INTO parts (id, sku, name, category, qty_on_hand, reorder_point, unit_cost, lead_time_days, supplier)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const partIds: string[] = [];
db.transaction(() => {
  let i = 0;
  // Two size/grade variants of each catalog item gets us to 80 parts.
  for (const variant of ["A", "B"]) {
    for (const [category, prefix, stem, cost] of PART_CATALOG) {
      i += 1;
      const id = `PRT-${String(i).padStart(4, "0")}`;
      partIds.push(id);
      const reorder = rng.int(2, 12);
      // Roughly 10% of SKUs sit below their reorder point.
      const qty = rng.chance(0.1)
        ? rng.int(0, Math.max(0, reorder - 1))
        : rng.int(reorder, reorder + 30);
      insertPart.run(
        id,
        `${prefix}-${rng.int(1000, 9899)}-${variant}`,
        `${stem} (Grade ${variant})`,
        category,
        qty,
        reorder,
        Math.round(cost * rng.float(0.85, 1.25) * 100) / 100,
        rng.pick([3, 5, 7, 10, 14, 21, 30, 45, 60]),
        rng.pick(SUPPLIERS),
      );
    }
  }
})();

// ------------------------------------------------------------- work orders

const WO_TEMPLATES: Record<string, [string, string][]> = {
  corrective: [
    [
      "Replace failed {part} on {asset}",
      "Unit reported abnormal operation. Replace the affected component, verify torque specs, and run a 2-hour load test before returning to service.",
    ],
    [
      "Investigate abnormal noise on {asset}",
      "Operator reported intermittent knocking under load. Isolate the source, document findings with photos, and submit a repair recommendation.",
    ],
    [
      "Repair coolant leak on {asset}",
      "Visible coolant seepage at the heat exchanger flange. Replace gasket, pressure-test the loop, and confirm no loss over 24 hours.",
    ],
    [
      "Correct low oil pressure on {asset}",
      "Oil pressure trending below the operating band. Inspect pump, relief valve, and filter condition. Replace worn components as found.",
    ],
  ],
  preventive: [
    [
      "{interval}-hour service on {asset}",
      "Scheduled service per OEM manual: replace filters, sample and top off oil, inspect belts and hoses, record as-found and as-left readings.",
    ],
    [
      "Oil and filter change on {asset}",
      "Drain and replace lubricating oil, replace primary and secondary filters, pull an oil sample for lab analysis.",
    ],
    [
      "Coolant system flush on {asset}",
      "Flush coolant loop, replace coolant per spec, inspect hoses and clamps, verify thermostat operation.",
    ],
  ],
  inspection: [
    [
      "Quarterly vibration survey at {location}",
      "Collect vibration signatures on all rotating equipment at the site, compare against baseline, flag units exceeding ISO 10816 zone B.",
    ],
    [
      "Borescope inspection on {asset}",
      "Inspect cylinder bores and valve seats via borescope, document wear patterns, score against acceptance criteria.",
    ],
    [
      "Compliance inspection on {asset}",
      "Annual regulatory inspection: verify safety devices, alarms, shutdowns, and documentation are current and functional.",
    ],
  ],
  predictive: [
    [
      "Inspect bearings on {asset} (vibration anomaly)",
      "Predictive model flagged a sustained vibration anomaly. Inspect bearing condition, check alignment, and collect a full spectrum reading for analysis.",
    ],
    [
      "Investigate temperature trend on {asset}",
      "Predictive model flagged a rising temperature trend. Verify cooling circuit performance, inspect heat exchanger fouling, and confirm sensor calibration.",
    ],
    [
      "Investigate falling oil pressure trend on {asset}",
      "Predictive model flagged a declining oil pressure trend. Inspect for internal leakage, verify pump output, and pull an oil sample for wear metals.",
    ],
  ],
};

const insertWo = db.prepare(`
  INSERT INTO work_orders (id, asset_id, title, description, status, priority, type, assigned_to, created_at, due_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertWoPart = db.prepare(
  "INSERT INTO work_order_parts (work_order_id, part_id, qty) VALUES (?, ?, ?)",
);

const DAY = 24 * HOUR;

db.transaction(() => {
  let woSeq = 1000;
  const statuses: [string, number][] = [
    ["open", 30],
    ["in_progress", 40],
    ["awaiting_parts", 20],
    ["closed", 60],
  ];

  // Give every degrading asset a recent, plausible predictive or corrective
  // order so detail views of high-risk assets show live maintenance response.
  const degraded = [...degradation.entries()].filter(
    ([, d]) => d.tier !== "medium",
  );
  const reservedAssets = new Set(degraded.map(([id]) => id));

  for (const [status, count] of statuses) {
    for (let i = 0; i < count; i++) {
      woSeq += 1;
      const id = `WO-${woSeq}`;

      let assetSeed: AssetSeed;
      let type: string;
      if (status !== "closed" && degraded.length > 0 && rng.chance(0.22)) {
        const [degId] = degraded[rng.int(0, degraded.length - 1)];
        assetSeed = assets.find((a) => a.id === degId)!;
        type = "predictive";
      } else {
        assetSeed = rng.pick(
          assets.filter((a) => !reservedAssets.has(a.id)),
        );
        type = rng.pick([
          "corrective",
          "corrective",
          "preventive",
          "preventive",
          "preventive",
          "inspection",
          "predictive",
        ]);
      }

      const [titleT, desc] = rng.pick(WO_TEMPLATES[type]);
      const part = rng.pick(PART_CATALOG);
      const title = titleT
        .replace("{asset}", `${assetSeed.name} (${assetSeed.id})`)
        .replace("{part}", part[2].toLowerCase())
        .replace("{location}", assetSeed.location)
        .replace("{interval}", String(rng.pick([250, 500, 1000, 2000])));

      // Closed orders skew recent and open orders spread wider so the
      // trailing-30d vs prior-30d failure counts stay comparable; otherwise
      // the MTBF trend KPI swings to implausible double-digit drops.
      const createdAt =
        status === "closed"
          ? nowTs - rng.int(5, 75) * DAY - rng.int(0, 23) * HOUR
          : nowTs - rng.int(0, 45) * DAY - rng.int(1, 23) * HOUR;
      const dueAt =
        status === "closed"
          ? createdAt + rng.int(7, 21) * DAY
          : nowTs + rng.int(-3, 14) * DAY;
      const completedAt =
        status === "closed" ? createdAt + rng.int(2, 18) * DAY : null;

      const priority =
        type === "predictive" || status === "awaiting_parts"
          ? rng.pick(["high", "urgent", "high", "medium"])
          : rng.pick(["low", "medium", "medium", "high"]);

      insertWo.run(
        id,
        assetSeed.id,
        title,
        desc,
        status,
        priority,
        type,
        rng.chance(0.85) ? rng.pick(techIds) : null,
        createdAt,
        dueAt,
        completedAt,
      );

      // Parts on roughly half of all orders, always on awaiting_parts.
      if (status === "awaiting_parts" || rng.chance(0.45)) {
        const n = rng.int(1, 3);
        const chosen = rng.shuffle([...partIds]).slice(0, n);
        for (const partId of chosen) {
          insertWoPart.run(id, partId, rng.int(1, 6));
        }
      }
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    "wo_seq",
    String(woSeq),
  );
})();

// ---------------------------------------------------- maintenance schedule

const PM_TASKS: [string, number, number][] = [
  ["Oil sample and analysis", 30, 1.5],
  ["Filter replacement", 90, 3],
  ["Vibration baseline survey", 90, 2],
  ["Coolant analysis", 60, 1],
  ["Valve clearance check", 180, 8],
  ["Borescope inspection", 365, 6],
  ["Alignment verification", 180, 4],
  ["Megger / insulation test", 365, 3],
  ["Belt and coupling inspection", 60, 2],
  ["Fuel injector service", 365, 10],
  ["Heat exchanger cleaning", 180, 6],
  ["Safety shutdown function test", 90, 2],
];

const insertPm = db.prepare(`
  INSERT INTO maintenance_schedule (id, asset_id, task, interval_days, next_due, assigned_to, est_hours)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  let pmSeq = 0;
  for (const asset of assets) {
    const taskCount = rng.int(1, 2);
    const tasks = rng.shuffle([...PM_TASKS]).slice(0, taskCount);
    for (const [task, interval, estHours] of tasks) {
      pmSeq += 1;
      const dueInDays = rng.int(0, 44);
      const due = new Date((nowTs + dueInDays * DAY) * 1000);
      const dueIso = due.toISOString().slice(0, 10);
      insertPm.run(
        `PM-${String(pmSeq).padStart(4, "0")}`,
        asset.id,
        task,
        interval,
        dueIso,
        rng.chance(0.7) ? rng.pick(techIds) : null,
        estHours,
      );
    }
  }
})();

// -------------------------------------------------------------------- meta

db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
  "generated_at",
  String(nowTs),
);

// ----------------------------------------------------------------- summary

const counts = {
  assets: db.prepare("SELECT COUNT(*) c FROM assets").get() as { c: number },
  readings: db.prepare("SELECT COUNT(*) c FROM sensor_readings").get() as {
    c: number;
  },
  anomalies: db.prepare("SELECT COUNT(*) c FROM anomalies").get() as {
    c: number;
  },
  anomalies7d: db
    .prepare("SELECT COUNT(*) c FROM anomalies WHERE ts >= ?")
    .get(sevenDaysAgo) as { c: number },
  wos: db.prepare("SELECT COUNT(*) c FROM work_orders").get() as { c: number },
  parts: db.prepare("SELECT COUNT(*) c FROM parts").get() as { c: number },
  lowStock: db
    .prepare("SELECT COUNT(*) c FROM parts WHERE qty_on_hand < reorder_point")
    .get() as { c: number },
  pm: db.prepare("SELECT COUNT(*) c FROM maintenance_schedule").get() as {
    c: number;
  },
  bands: db
    .prepare(
      "SELECT risk_band, COUNT(*) c FROM assets GROUP BY risk_band ORDER BY c",
    )
    .all() as { risk_band: string; c: number }[],
};

db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

console.log("Database generated:", OUT_PATH);
console.log(`  assets:        ${counts.assets.c}`);
console.log(`  readings:      ${counts.readings.c}`);
console.log(`  anomalies:     ${counts.anomalies.c} (${counts.anomalies7d.c} in last 7d)`);
console.log(`  work orders:   ${counts.wos.c}`);
console.log(`  parts:         ${counts.parts.c} (${counts.lowStock.c} below reorder)`);
console.log(`  pm tasks:      ${counts.pm.c}`);
console.log(
  "  risk bands:    " +
    counts.bands.map((b) => `${b.risk_band}=${b.c}`).join(", "),
);
