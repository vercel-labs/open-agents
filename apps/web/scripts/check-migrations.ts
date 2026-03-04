/**
 * Check that committed migrations are in sync with schema.ts.
 *
 * Runs `drizzle-kit generate` and checks whether it produced new migration
 * files.  If it did, the schema has drifted from the migrations and the
 * developer needs to commit the new migration.
 *
 * Usage:  bun run scripts/check-migrations.ts
 */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(
  import.meta.dirname,
  "..",
  "lib",
  "db",
  "migrations",
);

// Snapshot existing .sql files before generation
const before = new Set(
  readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")),
);

// Run drizzle-kit generate (produces a new .sql file if schema drifted)
try {
  execSync("bun run db:generate", {
    cwd: join(import.meta.dirname, ".."),
    stdio: "pipe",
  });
} catch (error: unknown) {
  // drizzle-kit generate exits 0 even when "nothing to generate", but
  // if it truly fails we should surface it.
  const msg = error instanceof Error ? error.message : String(error);
  if (!msg.includes("No schema changes")) {
    console.error("drizzle-kit generate failed:", msg);
    process.exit(1);
  }
}

const after = new Set(
  readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")),
);

const newFiles = [...after].filter((f) => !before.has(f));

if (newFiles.length > 0) {
  console.error(
    "❌ Schema has drifted from migrations. New migration(s) generated:\n",
  );
  for (const f of newFiles) {
    console.error(`   ${f}`);
  }
  console.error(
    "\nRun `bun run --cwd apps/web db:generate` and commit the result.",
  );
  process.exit(1);
}

console.log("✓ Migrations are in sync with schema.ts");
