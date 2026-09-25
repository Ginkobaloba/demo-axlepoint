import type { PoolClient } from "pg";

/**
 * A write-only stand-in for the better-sqlite3 handle the generator used.
 *
 * WHY AN ADAPTER RATHER THAN A REWRITE. `scripts/generate-db.ts` is 1061 lines,
 * of which exactly 28 touch the database. The other thousand compute the demo
 * world: the seeded RNG, the EWMA detector, risk scoring, the whole
 * distribution the repo's acceptance criteria are written against. Rewriting
 * the persistence layer in place would have meant editing around all of it and
 * hoping the data came out the same. With this sink the generation code is
 * BYTE-IDENTICAL, so "did the port change the data?" is answerable by diffing
 * the output instead of by reading a diff.
 *
 * It collects rows in memory and flushes them in chunked multi-row INSERTs.
 * That matters: the generator emits ~544,000 sensor readings, and a round trip
 * per row would take minutes.
 *
 * IT IS DELIBERATELY NARROW AND LOUD. It understands the exact statements the
 * generator issues and THROWS on anything else. A sink that quietly ignored an
 * unrecognised statement would produce a database missing whatever that
 * statement did, and the generator would still print its cheerful summary.
 */

type Row = unknown[];

interface Prepared {
  run(...values: Row): void;
  all<T>(): T[];
}

/** Postgres caps a statement at 65535 bind parameters; stay well under it. */
const MAX_PARAMS_PER_STATEMENT = 30000;

export class PgSink {
  private readonly tables = new Map<string, { cols: string[]; rows: Row[] }>();

  /**
   * `schema` is where rows are written. The generator targets `pristine`,
   * which has no tenant_id -- the live tenant is populated FROM pristine by
   * the reset, so the seed and the reset share one code path and cannot
   * disagree about what the pristine world contains.
   */
  constructor(
    private readonly schema: string,
    private readonly tenantId?: string,
  ) {}

  /**
   * better-sqlite3's `db.transaction(fn)` returns a function that runs `fn` in
   * a transaction. Here the whole generation run is one transaction at flush
   * time, so this just hands the body back and `db.transaction(body)()` still
   * reads correctly at every call site.
   */
  transaction<T>(fn: () => T): () => T {
    return fn;
  }

  /** The schema comes from db/schema.sql, applied before the generator runs. */
  exec(_sql: string): void {
    // intentionally empty
  }

  prepare(sql: string): Prepared {
    const insert = /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i.exec(sql);
    if (insert) {
      const table = insert[1];
      const cols = insert[2].split(",").map((c) => c.trim());
      if (!this.tables.has(table)) this.tables.set(table, { cols, rows: [] });
      const entry = this.tables.get(table)!;
      if (entry.cols.join(",") !== cols.join(",")) {
        throw new Error(
          `Two different column lists for ${table}: [${entry.cols}] then [${cols}]. ` +
            "The sink collects one shape per table.",
        );
      }
      return {
        run: (...values: Row) => {
          if (values.length !== cols.length) {
            throw new Error(
              `${table}: ${values.length} values for ${cols.length} columns.`,
            );
          }
          entry.rows.push(values);
        },
        all: () => {
          throw new Error("all() on an INSERT statement.");
        },
      };
    }

    // The generator reads its own parts back, to group purchase orders by
    // supplier. Nothing has been flushed at that point, so the read is served
    // from the collected rows. Only this exact shape is supported --
    // "SELECT <cols> FROM <table>", no WHERE, no join, no aggregate -- because
    // anything richer would be a query engine, and the moment this sink starts
    // guessing at SQL semantics it can return a WRONG answer instead of
    // refusing.
    const select = /^\s*SELECT\s+([\w\s,]+?)\s+FROM\s+(\w+)\s*$/i.exec(sql);
    if (select) {
      const wanted = select[1].split(",").map((c) => c.trim());
      const table = select[2];
      return {
        run: () => {
          throw new Error("run() on a SELECT statement.");
        },
        all: <T,>(): T[] => {
          const entry = this.tables.get(table);
          if (!entry) throw new Error(`SELECT from ${table} before any row was collected.`);
          const idx = wanted.map((c) => {
            const i = entry.cols.indexOf(c);
            if (i < 0) throw new Error(`${table} has no collected column "${c}".`);
            return i;
          });
          return entry.rows.map((row) => {
            const o: Record<string, unknown> = {};
            wanted.forEach((c, k) => (o[c] = row[idx[k]]));
            return o as T;
          });
        },
      };
    }

    // The generator issues exactly one UPDATE, right after the asset inserts
    // and before anything is flushed, so it is applied to the collected rows
    // rather than to the database.
    if (/^\s*UPDATE\s+assets\s+SET\s+status\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s*$/i.test(sql)) {
      return {
        all: () => {
          throw new Error("all() on an UPDATE statement.");
        },
        run: (...values: Row) => {
          const [status, id] = values as [string, string];
          const entry = this.tables.get("assets");
          if (!entry) throw new Error("UPDATE assets before any asset was inserted.");
          const idIdx = entry.cols.indexOf("id");
          const statusIdx = entry.cols.indexOf("status");
          if (idIdx < 0 || statusIdx < 0) {
            throw new Error("assets rows carry no id/status column to update.");
          }
          const row = entry.rows.find((r) => r[idIdx] === id);
          if (!row) throw new Error(`UPDATE assets: no collected row with id ${id}.`);
          row[statusIdx] = status;
        },
      };
    }

    throw new Error(
      `PgSink does not understand this statement, and will not ignore it:\n${sql}`,
    );
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [table, { rows }] of this.tables) out[table] = rows.length;
    return out;
  }

  /**
   * Writes everything in ONE transaction. Either the whole demo world lands or
   * none of it does; a half-seeded database that still looks populated is the
   * worst outcome available here.
   */
  async flush(client: PoolClient): Promise<void> {
    await client.query("BEGIN");
    try {
      for (const [table, { cols, rows }] of this.tables) {
        if (!rows.length) continue;
        const allCols = this.tenantId ? ["tenant_id", ...cols] : [...cols];
        const perRow = allCols.length;
        const rowsPerStatement = Math.max(
          1,
          Math.floor(MAX_PARAMS_PER_STATEMENT / perRow),
        );

        for (let i = 0; i < rows.length; i += rowsPerStatement) {
          const chunk = rows.slice(i, i + rowsPerStatement);
          const params: unknown[] = [];
          const tuples = chunk.map((row) => {
            const values = this.tenantId ? [this.tenantId, ...row] : row;
            const placeholders = values.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            return `(${placeholders.join(",")})`;
          });
          await client.query(
            `INSERT INTO ${this.schema}.${table} (${allCols.join(",")}) VALUES ${tuples.join(",")}`,
            params,
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  }
}
