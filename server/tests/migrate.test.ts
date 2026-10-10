/**
 * Integration tests for idempotent boot migrations against a real Postgres.
 * Needs TEST_ADMIN_DATABASE_URL (a role that can CREATE/DROP DATABASE); skipped otherwise.
 *   TEST_ADMIN_DATABASE_URL=postgres://root_app:root_app@localhost:5432/postgres npm test
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { runIdempotentMigrations } from "../db/migrate";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const EXPECTED_TABLES = 15;
const MIGRATIONS = readMigrationFiles({ migrationsFolder: folder }).length;

const dbName = `root_migrate_test_${process.pid}`;
let pool: pg.Pool | null = null;

async function admin<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function freshDb() {
  await pool?.end();
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${dbName}`);
  });
  const url = new URL(ADMIN!);
  url.pathname = `/${dbName}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  return pool;
}

/** Simulate Replit publish: create the schema's tables directly, with no drizzle journal. */
async function precreateWithoutJournal(p: pg.Pool) {
  for (const m of readMigrationFiles({ migrationsFolder: folder })) for (const stmt of m.sql) if (stmt.trim()) await p.query(stmt);
}

const q = async (p: pg.Pool, sql: string) => (await p.query(sql)).rows;
const tableCount = async (p: pg.Pool) => Number((await q(p, `select count(*)::int n from information_schema.tables where table_schema='public'`))[0].n);
const journalRows = async (p: pg.Pool) => Number((await q(p, `select count(*)::int n from drizzle.__drizzle_migrations`))[0].n);
const run = (p: pg.Pool) => runIdempotentMigrations(p, folder, () => migrate(drizzle(p), { migrationsFolder: folder }));

describe.skipIf(!ADMIN)("idempotent boot migrations (real Postgres)", () => {
  beforeEach(async () => {
    await freshDb();
  });
  afterAll(async () => {
    await pool?.end();
    if (ADMIN) await admin((c) => c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
  });

  it("reproduces the bug: plain drizzle migrate crashes when tables exist without a journal", async () => {
    await precreateWithoutJournal(pool!);
    const err = await migrate(drizzle(pool!), { migrationsFolder: folder }).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(err?.cause?.message ?? err?.message).toMatch(/relation "actions" already exists/);
  });

  it("baselines a DB whose tables exist but has no journal", async () => {
    await precreateWithoutJournal(pool!);
    await pool!.query(`insert into settings (key, value) values ('launchAt', '"2026-10-10T18:00:00.000Z"')`);
    const r = await run(pool!);
    expect(r.mode).toBe("baselined");
    // everything already existed: no DDL re-applied (only idempotent data UPDATEs from 0001, which match no rows)
    expect(r.applied.filter((s) => !/\bUPDATE\b/.test(s))).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(await journalRows(pool!)).toBe(readMigrationFiles({ migrationsFolder: folder }).length);
    expect(await tableCount(pool!)).toBe(EXPECTED_TABLES);
    // existing data untouched
    expect((await q(pool!, `select value from settings where key='launchAt'`))[0].value).toBe("2026-10-10T18:00:00.000Z");
  });

  it("creates only what's missing: a dropped table, index and columns", async () => {
    await precreateWithoutJournal(pool!);
    await pool!.query(`drop table x_spend`);
    await pool!.query(`drop index events_ts_idx`);
    await pool!.query(`alter table events drop column proof_url`); // nullable
    await pool!.query(`alter table memories drop column importance`); // NOT NULL DEFAULT 0.5
    await pool!.query(`insert into memories (kind, content) values ('episodic', 'kept')`);
    const r = await run(pool!);
    expect(r.mode).toBe("baselined");
    expect(r.applied.some((s) => /CREATE TABLE "x_spend"/.test(s))).toBe(true);
    expect(r.applied.some((s) => /events_ts_idx/.test(s))).toBe(true);
    expect(r.addedColumns).toEqual(expect.arrayContaining(["events.proof_url", "memories.importance"]));
    expect(await tableCount(pool!)).toBe(EXPECTED_TABLES);
    expect((await q(pool!, `select importance from memories`))[0].importance).toBe(0.5); // existing row backfilled by default
    expect((await q(pool!, `select to_regclass('public.events_ts_idx') r`))[0].r).toBe("events_ts_idx");
  });

  it("is a no-op on the next boot", async () => {
    await precreateWithoutJournal(pool!);
    await run(pool!);
    const r2 = await run(pool!);
    expect(r2.mode).toBe("fresh-or-journaled");
    expect(r2.applied).toEqual([]);
    expect(await journalRows(pool!)).toBe(readMigrationFiles({ migrationsFolder: folder }).length);
  });

  it("migrates an empty database normally", async () => {
    const r = await run(pool!);
    expect(r.mode).toBe("fresh-or-journaled");
    expect(await tableCount(pool!)).toBe(EXPECTED_TABLES);
    expect(await journalRows(pool!)).toBe(MIGRATIONS);
  });

  it("baselines when the journal table exists but is empty", async () => {
    await precreateWithoutJournal(pool!);
    await pool!.query(`create schema drizzle; create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    const r = await run(pool!);
    expect(r.mode).toBe("baselined");
    expect(await journalRows(pool!)).toBe(MIGRATIONS);
  });

  it("repairs a DB whose journal survived but whose tables were dropped", async () => {
    await run(pool!); // normal migrate: tables + journal
    await pool!.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); // drizzle schema (journal) kept
    // the bug: plain drizzle now does nothing, so the first query fails
    await migrate(drizzle(pool!), { migrationsFolder: folder });
    const err = await pool!.query(`select * from settings`).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/relation "settings" does not exist/);
    const r = await run(pool!);
    expect(r.mode).toBe("repaired");
    expect(r.missingTables.length).toBe(EXPECTED_TABLES);
    expect(await tableCount(pool!)).toBe(EXPECTED_TABLES);
    expect(await journalRows(pool!)).toBe(MIGRATIONS); // no duplicate journal rows
    expect((await run(pool!)).mode).toBe("fresh-or-journaled");
  });

  it("repairs a single missing table even with a journal", async () => {
    await run(pool!);
    await pool!.query(`drop table settings`);
    const r = await run(pool!);
    expect(r.mode).toBe("repaired");
    expect(r.missingTables).toEqual(["settings"]);
    expect(await tableCount(pool!)).toBe(EXPECTED_TABLES);
  });

  it("renames Baby Brain labels on an existing DB, idempotently", async () => {
    // an old deployment: journaled with only 0000_init
    const old = fs.mkdtempSync(path.join(os.tmpdir(), "root-mig-"));
    fs.mkdirSync(path.join(old, "meta"));
    fs.copyFileSync(path.join(folder, "0000_init.sql"), path.join(old, "0000_init.sql"));
    fs.copyFileSync(path.join(folder, "meta/0000_snapshot.json"), path.join(old, "meta/0000_snapshot.json"));
    const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(path.join(old, "meta/_journal.json"), JSON.stringify(journal));
    await migrate(drizzle(pool!), { migrationsFolder: old });
    await pool!.query(`insert into events (type, source, message) values ('BIRTH','BABY','hi'), ('DEVELOPMENT','SYSTEM','x'), ('CHAT','BABY','y')`);
    await pool!.query(`insert into timeline_fired (step_id, age_s) values ('birth', 0), ('neonatal_complete', 1800)`);

    expect((await run(pool!)).mode).toBe("fresh-or-journaled");
    const rows = await q(pool!, `select type, source from events order by id`);
    expect(rows).toEqual([{ type: "BOOT", source: "ROOT" }, { type: "PROGRESS", source: "SYSTEM" }, { type: "CHAT", source: "ROOT" }]);
    expect((await q(pool!, `select step_id from timeline_fired order by age_s`)).map((r) => r.step_id)).toEqual(["root_shell", "breach_complete"]);
    expect(await journalRows(pool!)).toBe(MIGRATIONS);
    // next boot: nothing to do, nothing changes
    expect((await run(pool!)).applied).toEqual([]);
    expect(await q(pool!, `select type, source from events order by id`)).toEqual(rows);
    fs.rmSync(old, { recursive: true, force: true });
  });

  it("serialises concurrent boots", async () => {
    await precreateWithoutJournal(pool!);
    const [a, b] = await Promise.all([run(pool!), run(pool!)]);
    expect([a.mode, b.mode].sort()).toEqual(["baselined", "fresh-or-journaled"]);
    expect(await journalRows(pool!)).toBe(MIGRATIONS);
  });
});
