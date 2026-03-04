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

try {
  console.log("Running database migrations…");
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  console.log("Migrations applied successfully");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
