import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

const MIGRATIONS_FOLDER = "./lib/db/migrations";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const LEGACY_IGNORABLE_ERROR_CODES = new Set([
  "42P01", // undefined_table
  "42P06", // duplicate_schema
  "42P07", // duplicate_table / duplicate_relation
  "42701", // duplicate_column
  "42703", // undefined_column
  "42710", // duplicate_object
]);

type MigrationFile = {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
};

type ErrorWithCause = {
  code?: string;
  message?: string;
  cause?: unknown;
};

const url = process.env.POSTGRES_URL;
if (!url) {
  console.log("POSTGRES_URL not set — skipping migrations");
  process.exit(0);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const current = error as ErrorWithCause;
  if (typeof current.code === "string") {
    return current.code;
  }

  return getErrorCode(current.cause);
}

function getErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }

  const current = error as ErrorWithCause;
  if (typeof current.message === "string") {
    return current.message;
  }

  if (current.cause) {
    return getErrorMessage(current.cause);
  }

  return "Unknown database error";
}

function isIgnorableLegacyError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code ? LEGACY_IGNORABLE_ERROR_CODES.has(code) : false;
}

async function ensureMigrationsTable(): Promise<void> {
  await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function hasRecordedMigrations(): Promise<boolean> {
  const rows = await client.unsafe(`
    SELECT 1
    FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
    LIMIT 1
  `);

  return rows.length > 0;
}

async function hasLegacySchemaWithoutHistory(): Promise<boolean> {
  const rows = (await client.unsafe(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'accounts'
    ) AS has_accounts
  `)) as Array<{ has_accounts?: boolean }>;

  return rows[0]?.has_accounts === true;
}

async function reconcileLegacySchema(): Promise<void> {
  console.log(
    "Detected existing schema without migration history. Reconciling migration records…",
  );

  const migrations = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  }) as MigrationFile[];

  for (const migration of migrations) {
    for (const statement of migration.sql) {
      const sql = statement.trim();
      if (!sql) {
        continue;
      }

      try {
        await client.unsafe(sql);
      } catch (error) {
        if (isIgnorableLegacyError(error)) {
          console.log(
            `Skipping already-applied statement (${getErrorCode(error)}): ${getErrorMessage(error)}`,
          );
          continue;
        }

        throw error;
      }
    }

    await client.unsafe(
      `
        INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at")
        SELECT $1, $2
        WHERE NOT EXISTS (
          SELECT 1 FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" WHERE created_at = $2
        )
      `,
      [migration.hash, migration.folderMillis],
    );
  }

  console.log("Legacy migration reconciliation complete");
}

try {
  await ensureMigrationsTable();

  const migrationsRecorded = await hasRecordedMigrations();
  if (!migrationsRecorded && (await hasLegacySchemaWithoutHistory())) {
    await reconcileLegacySchema();
  }

  console.log("Running database migrations…");
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migrations applied successfully");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
