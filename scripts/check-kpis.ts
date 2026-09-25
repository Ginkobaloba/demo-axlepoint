/**
 * KPI sanity check used while tuning the generator. CLAUDE.md points at this
 * after any change to anomaly.ts or risk.ts: sane is 3-6 critical, distinct
 * top scores, MTBF delta within +/-35%.
 *
 * Reads the seeded tenant in Postgres. Needs DATABASE_URL.
 */
import { Pool } from "pg";

const TENANT = process.env.AXLEPOINT_SEED_TENANT ?? "sample";
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const one = async (sql: string, params: unknown[] = []) =>
      (await pool.query(sql, params)).rows[0];

    const now = Number(
      (await one("SELECT value FROM meta WHERE tenant_id=$1 AND key='generated_at'", [TENANT])).value,
    );
    const DAY = 86400;
    const count = async (from: number, to: number) =>
      Number(
        (
          await one(
            `SELECT COUNT(*)::int c FROM work_orders
              WHERE tenant_id=$1 AND type='corrective' AND created_at >= $2 AND created_at < $3`,
            [TENANT, from, to],
          )
        ).c,
      );

    const recent = await count(now - 30 * DAY, now);
    const prior = await count(now - 60 * DAY, now - 30 * DAY);
    const mtbfRecent = (100 * 30 * 24) / Math.max(1, recent);
    const mtbfPrior = (100 * 30 * 24) / Math.max(1, prior);
    console.log(
      `corrective WOs: recent30d=${recent} prior30d=${prior} ` +
        `mtbf=${Math.round(mtbfRecent)}h delta=${Math.round(((mtbfRecent - mtbfPrior) / mtbfPrior) * 100)}%`,
    );
    const top = (
      await pool.query(
        "SELECT id, risk_score FROM assets WHERE tenant_id=$1 ORDER BY risk_score DESC LIMIT 3",
        [TENANT],
      )
    ).rows;
    console.log("max risk:", JSON.stringify(top));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
