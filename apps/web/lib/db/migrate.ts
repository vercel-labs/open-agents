import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.log("POSTGRES_URL not set — skipping migrations");
  process.exit(0);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

/**
 * Baseline: if the database was bootstrapped via `db:push`, tables exist but
 * the drizzle migration ledger is missing entries.  This function compares the
 * journal on disk with the rows in `__drizzle_migrations` and inserts any
 * missing entries so `migrate()` won't try to replay already-applied DDL.
 */
async function baselineIfNeeded() {
  // Check if any app table exists (db:push was used)
  const [{ exists: tablesExist }] = await client`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'users'
		)`;

  if (!tablesExist) return; // fresh database — nothing to baseline

  // Ensure the drizzle schema + migrations table exist
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
		CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
			id serial PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)`;

  // Get already-tracked hashes
  const tracked = await client`
		SELECT hash FROM drizzle."__drizzle_migrations"`;
  const trackedHashes = new Set(tracked.map((r) => r.hash as string));

  // Read the journal
  const journalPath = join(
    import.meta.dirname,
    "migrations",
    "meta",
    "_journal.json",
  );
  const journal = JSON.parse(readFileSync(journalPath, "utf-8"));

  // Get all public tables that currently exist in the database.
  const existingTablesResult = await client`
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public'`;
  const existingTables = new Set(
    existingTablesResult.map((r) => (r.table_name as string).toLowerCase()),
  );

  const migrationSqlByTag = new Map<string, string>();
  const droppedTablesByTag = new Map<string, Set<string>>();

  for (const entry of journal.entries) {
    const sqlPath = join(import.meta.dirname, "migrations", `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf-8");
    migrationSqlByTag.set(entry.tag, sql);

    const droppedTables = new Set(
      [
        ...sql.matchAll(
          /DROP TABLE(?: IF EXISTS)?\s+(?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi,
        ),
      ].map((m) => m[1].toLowerCase()),
    );

    droppedTablesByTag.set(entry.tag, droppedTables);
  }

  const isDroppedByLaterMigration = (table: string, fromIndex: number) => {
    for (let i = fromIndex + 1; i < journal.entries.length; i++) {
      const droppedTables = droppedTablesByTag.get(journal.entries[i].tag);
      if (droppedTables?.has(table)) return true;
    }

    return false;
  };

  let baselined = 0;
  for (const [index, entry] of journal.entries.entries()) {
    const sql = migrationSqlByTag.get(entry.tag);
    if (!sql) continue;

    const hash = new Bun.CryptoHasher("sha256").update(sql).digest("hex");

    if (trackedHashes.has(hash)) continue; // already tracked

    // If this migration creates a table that doesn't exist yet (and is not
    // removed by a later migration), this migration genuinely needs to run.
    const createdTables = [
      ...sql.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi,
      ),
    ].map((m) => m[1].toLowerCase());

    if (
      createdTables.some(
        (table) =>
          !existingTables.has(table) &&
          !isDroppedByLaterMigration(table, index),
      )
    ) {
      break;
    }

    await client`
			INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
			VALUES (${hash}, ${entry.when})`;
    trackedHashes.add(hash);
    baselined++;
  }

  if (baselined > 0) {
    console.log(
      `Baselined ${baselined} migration(s) (db:push → migrations sync)`,
    );
  }
}

try {
  console.log("Running database migrations…");
  await baselineIfNeeded();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  console.log("Migrations applied successfully");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
