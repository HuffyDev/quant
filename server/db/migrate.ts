import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

/**
 * Idempotent boot migrations.
 *
 * Normal case: drizzle's migrator applies whatever is newer than the last row in drizzle.__drizzle_migrations.
 *
 * Baseline case (e.g. Replit publish pre-creates tables from the dev schema but no journal): app tables exist
 * while the journal is missing/empty. Re-running CREATE TABLE would fail with "relation already exists", so instead
 * we apply every migration statement one by one, skipping anything that already exists, add any columns the
 * existing tables are missing (from the latest drizzle snapshot), then record the journal so later migrations
 * run normally.
 */

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const LOCK_KEY = 0x6262_6d67; // "bbmg" — serialises concurrent boots

/** Postgres "already exists" errors that are safe to skip while baselining. */
const ALREADY_EXISTS = new Set(["42P07", "42710", "42701", "42P06", "42723"]);

export interface MigrationReport {
  mode: "fresh-or-journaled" | "baselined" | "repaired";
  missingTables: string[];
  skipped: string[];
  applied: string[];
  addedColumns: string[];
  missingColumnsNotAdded: string[];
}

const short = (sql: string) => sql.replace(/\s+/g, " ").trim().slice(0, 90);

async function journalCount(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query<{ reg: string | null }>(`select to_regclass('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}') as reg`);
  if (!rows[0]?.reg) return 0;
  const r = await c.query<{ n: number }>(`select count(*)::int as n from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`);
  return r.rows[0]?.n ?? 0;
}

async function existingAppTables(c: pg.PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
  return rows.map((r) => r.table_name);
}

interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string | number | boolean;
}

/** Latest drizzle-kit snapshot = the full expected schema. */
function latestSnapshot(folder: string): Record<string, { name: string; schema: string; columns: Record<string, SnapshotColumn> }> | null {
  const meta = path.join(folder, "meta");
  if (!fs.existsSync(meta)) return null;
  const files = fs.readdirSync(meta).filter((f) => /_snapshot\.json$/.test(f)).sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(meta, files[files.length - 1]), "utf8")).tables ?? null;
}

const SERIAL: Record<string, string> = { serial: "integer", bigserial: "bigint", smallserial: "smallint" };

/** Add columns the existing tables lack. NOT NULL is only applied when a default makes it safe for existing rows. */
async function reconcileColumns(c: pg.PoolClient, folder: string, report: MigrationReport) {
  const snap = latestSnapshot(folder);
  if (!snap) return;
  for (const t of Object.values(snap)) {
    const schema = t.schema || "public";
    const { rows } = await c.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, t.name]);
    if (!rows.length) continue; // table itself missing → handled by its CREATE TABLE statement
    const have = new Set(rows.map((r) => r.column_name));
    for (const col of Object.values(t.columns)) {
      if (have.has(col.name)) continue;
      const label = `${t.name}.${col.name}`;
      if (col.primaryKey || SERIAL[col.type]) {
        report.missingColumnsNotAdded.push(`${label} (primary key / serial — fix manually)`);
        continue;
      }
      const def = col.default !== undefined ? ` DEFAULT ${col.default}` : "";
      const notNull = col.notNull && def ? " NOT NULL" : "";
      await c.query(`ALTER TABLE "${schema}"."${t.name}" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${def}${notNull}`);
      report.addedColumns.push(label + (col.notNull && !def ? " (added nullable: no default to back NOT NULL)" : ""));
    }
  }
}

async function baseline(c: pg.PoolClient, migrations: MigrationMeta[], folder: string, report: MigrationReport) {
  await c.query("BEGIN");
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await c.query(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    for (const m of migrations) {
      for (const stmt of m.sql) {
        if (!stmt.trim()) continue;
        await c.query("SAVEPOINT bb_stmt");
        try {
          await c.query(stmt);
          await c.query("RELEASE SAVEPOINT bb_stmt");
          report.applied.push(short(stmt));
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT bb_stmt");
          const code = (e as { code?: string }).code;
          if (!code || !ALREADY_EXISTS.has(code)) throw e;
          report.skipped.push(short(stmt));
        }
      }
      // record each migration once (a repair may run against a journal that already lists it)
      await c.query(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") SELECT $1::text, $2::bigint
         WHERE NOT EXISTS (SELECT 1 FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" WHERE hash = $1::text)`,
        [m.hash, m.folderMillis],
      );
    }
    await reconcileColumns(c, folder, report);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/**
 * @param runDrizzle the normal drizzle migrator (applies anything newer than the journal)
 */
export async function runIdempotentMigrations(pool: pg.Pool, folder: string, runDrizzle: () => Promise<void>): Promise<MigrationReport> {
  const report: MigrationReport = { mode: "fresh-or-journaled", missingTables: [], skipped: [], applied: [], addedColumns: [], missingColumnsNotAdded: [] };
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const journaled = await journalCount(c);
      const tables = await existingAppTables(c);
      const expected = Object.values(latestSnapshot(folder) ?? {}).map((t) => t.name);
      report.missingTables = expected.filter((t) => !tables.includes(t));
      if (journaled === 0 && tables.length > 0) {
        // tables exist but no journal (e.g. Replit publish pre-created them)
        report.mode = "baselined";
        await baseline(c, migrations, folder, report);
      } else if (journaled > 0 && report.missingTables.length > 0) {
        // journal says "done" but tables are gone (e.g. public schema dropped, drizzle schema kept):
        // drizzle would apply nothing and boot would crash on the first query — re-create what's missing
        report.mode = "repaired";
        await baseline(c, migrations, folder, report);
      }
      await runDrizzle(); // no-op after a baseline unless newer migrations exist
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
  return report;
}
