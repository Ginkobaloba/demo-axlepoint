#!/usr/bin/env node
/**
 * Bring up the dev database and PROVE you are talking to it.
 *
 *   node scripts/dev-db.mjs          # up, verify, print the DATABASE_URL
 *   node scripts/dev-db.mjs --down   # stop it
 *
 * WHY THIS IS NOT JUST `docker compose up`. A `-p 127.0.0.1:PORT:5432` binding
 * can FAIL SILENTLY: the container comes up publishing nothing, and if some
 * other process already owns that port, every TCP connection goes THERE
 * instead. That happened while building the harborbistro suite -- the port
 * belonged to another session's Postgres, and the test was refused only
 * because the password differed. Had it matched, the suite would have dropped
 * their schemas.
 *
 * What made it hard to see: `docker exec psql` kept working the whole time,
 * because that uses the container's own socket. Only TCP went elsewhere. So
 * this script checks the thing that actually failed -- it READS THE PUBLISHED
 * PORT BACK out of docker, and then connects over TCP and asks the database to
 * identify itself.
 *
 * Three checks, in the order they can fail:
 *   1. the container published a host port at all
 *   2. TCP reaches a Postgres that accepts our credentials
 *   3. that Postgres holds only tables this project defines
 *
 * Check 3 is the one a smell test misses. See src/lib/scratch-db-guard.ts.
 */
import { execFileSync } from "node:child_process";
import pg from "pg";

const CONTAINER = "axlepoint-dev-db";
const COMPOSE = ["compose", "-f", "docker-compose.dev.yml"];

const sh = (args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

function down() {
  sh([...COMPOSE, "down"]);
  console.log("dev database stopped.");
}

function publishedPort() {
  // .NetworkSettings.Ports is where a FAILED binding shows up: the key exists
  // with an empty value. `docker port` would simply print nothing, which is
  // easy to mistake for "not started yet".
  const raw = sh([
    "inspect",
    CONTAINER,
    "--format",
    "{{json .NetworkSettings.Ports}}",
  ]);
  const ports = JSON.parse(raw);
  const bindings = ports["5432/tcp"];
  if (!bindings || bindings.length === 0) {
    throw new Error(
      `${CONTAINER} is running but published NO host port for 5432.\n` +
        "  That is what a silently failed port binding looks like. Something\n" +
        "  else almost certainly owns the port in docker-compose.dev.yml.\n" +
        "  Check with:  docker ps -a --format '{{.Names}}\\t{{.Ports}}'",
    );
  }
  return bindings[0].HostPort;
}

async function main() {
  if (process.argv.includes("--down")) return down();

  sh([...COMPOSE, "up", "-d"]);

  // Wait for the healthcheck rather than sleeping a guessed interval.
  for (let i = 0; i < 30; i++) {
    const status = sh(["inspect", CONTAINER, "--format", "{{.State.Health.Status}}"]);
    if (status === "healthy") break;
    if (i === 29) throw new Error(`${CONTAINER} never became healthy (last: ${status}).`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const port = publishedPort();
  const url = `postgres://axlepoint:axlepoint@127.0.0.1:${port}/axlepoint`;

  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    const { rows } = await pool.query(
      `SELECT current_database() AS db, current_user AS usr,
              (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS n`,
    );
    const { db, usr, n } = rows[0];
    if (db !== "axlepoint" || usr !== "axlepoint") {
      throw new Error(
        `Port ${port} answered, but as ${usr}@${db} -- not axlepoint@axlepoint.\n` +
          "  You are connected to a DIFFERENT database than the one just started.",
      );
    }
    console.log(`dev database ready: ${usr}@${db} on 127.0.0.1:${port} (${n} public tables)`);
    console.log(`  $env:DATABASE_URL = "${url}"`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
