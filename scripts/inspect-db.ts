/** Quick data-quality inspection used while tuning the generator. */
import Database from "better-sqlite3";

const db = new Database("data/axlepoint.db");

const bands = db
  .prepare("SELECT risk_band, COUNT(*) c FROM assets GROUP BY risk_band")
  .all();
console.log("bands:", JSON.stringify(bands));

for (const band of ["medium", "low", "high", "critical"]) {
  const rows = db
    .prepare(
      "SELECT id, risk_score, risk_factors FROM assets WHERE risk_band = ? ORDER BY risk_score LIMIT 3",
    )
    .all(band) as { id: string; risk_score: number; risk_factors: string }[];
  console.log(`--- ${band} (lowest 3)`);
  for (const r of rows) {
    console.log(` ${r.id} score=${r.risk_score}`);
    for (const f of JSON.parse(r.risk_factors) as {
      label: string;
      contribution: number;
      anomalies7d: number;
      trendPct7d: number;
    }[]) {
      if (f.contribution > 0)
        console.log(
          `    ${f.label}: contrib=${f.contribution} anoms7d=${f.anomalies7d} trend=${f.trendPct7d}%`,
        );
    }
  }
}

const sev = db
  .prepare(
    "SELECT severity, COUNT(*) c FROM anomalies WHERE ts >= (SELECT CAST(value AS INTEGER) FROM meta WHERE key='generated_at') - 7*86400 GROUP BY severity",
  )
  .all();
console.log("last-7d anomaly severities:", JSON.stringify(sev));
