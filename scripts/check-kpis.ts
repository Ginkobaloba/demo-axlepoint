/** KPI sanity check used while tuning the generator. */
import Database from "better-sqlite3";

const db = new Database("data/axlepoint.db");
const now = Number(
  (db.prepare("SELECT value FROM meta WHERE key='generated_at'").get() as {
    value: string;
  }).value,
);
const DAY = 86400;
const count = (from: number, to: number) =>
  (
    db
      .prepare(
        "SELECT COUNT(*) c FROM work_orders WHERE type='corrective' AND created_at >= ? AND created_at < ?",
      )
      .get(from, to) as { c: number }
  ).c;

const recent = count(now - 30 * DAY, now);
const prior = count(now - 60 * DAY, now - 30 * DAY);
const mtbfRecent = (100 * 30 * 24) / Math.max(1, recent);
const mtbfPrior = (100 * 30 * 24) / Math.max(1, prior);
console.log(
  `corrective WOs: recent30d=${recent} prior30d=${prior} ` +
    `mtbf=${Math.round(mtbfRecent)}h delta=${Math.round(((mtbfRecent - mtbfPrior) / mtbfPrior) * 100)}%`,
);
console.log(
  "max risk:",
  JSON.stringify(
    db.prepare("SELECT id, risk_score FROM assets ORDER BY risk_score DESC LIMIT 3").all(),
  ),
);
