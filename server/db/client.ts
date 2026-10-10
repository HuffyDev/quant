import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env";
import * as schema from "./schema";
import { runIdempotentMigrations } from "./migrate";

const ssl =
  /sslmode=require/.test(env.DATABASE_URL) || /neon\.tech/.test(env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined;

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10, ssl });
export const db = drizzle(pool, { schema });
export type DB = typeof db;

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const folder = path.resolve(here, "../../drizzle");
  const report = await runIdempotentMigrations(pool, folder, () => migrate(db, { migrationsFolder: folder }));
  if (report.mode !== "fresh-or-journaled") {
    const why =
      report.mode === "baselined"
        ? "tables existed without a migrations journal — baselined"
        : `journal present but ${report.missingTables.length} table(s) missing (${report.missingTables.join(", ")}) — repaired`;
    console.log(
      `[db] ${why}: ${report.applied.length} statement(s) applied, ` +
        `${report.skipped.length} already present, ${report.addedColumns.length} column(s) added`,
    );
    for (const s of report.applied) console.log(`[db]   created: ${s}`);
    for (const s of report.addedColumns) console.log(`[db]   added column: ${s}`);
    for (const s of report.missingColumnsNotAdded) console.warn(`[db]   MISSING COLUMN (not auto-added): ${s}`);
  }
  return report;
}
