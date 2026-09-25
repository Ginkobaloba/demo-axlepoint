/**
 * Quick data-quality inspection used while tuning the generator. CLAUDE.md
 * pairs this with check-kpis.ts after any change to anomaly.ts or risk.ts.
 *
 * Reads the seeded tenant in Postgres. Needs DATABASE_URL.
 */
import { Pool } from "pg";

const TENANT = process.env.AXLEPOINT_SEED_TENANT ?? "sample";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const bands = (
      await pool.query(
        "SELECT risk_band, COUNT(*)::int c FROM assets WHERE tenant_id=$1 GROUP BY risk_band",
        [TENANT],
      )
    ).rows;
      console.log("bands:", JSON.stringify(bands));

  for (const band of ["medium", "low", "high", "critical"]) {
    const rows = (
      await pool.query<{ id: string; risk_score: number; risk_factors: string }>(
        `SELECT id, risk_score, risk_factors FROM assets
          WHERE tenant_id = $1 AND risk_band = $2 ORDER BY risk_score LIMIT 3`,
        [TENANT, band],
      )
    ).rows;
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

    const sev = (
      await pool.query(
        `SELECT severity, COUNT(*)::int c FROM anomalies
          WHERE tenant_id = $1
            AND ts >= (SELECT value::bigint FROM meta WHERE tenant_id = $1 AND key = 'generated_at') - 7*86400
          GROUP BY severity`,
        [TENANT],
      )
    ).rows;
    console.log("last-7d anomaly severities:", JSON.stringify(sev));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
