import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  ...(process.env.POSTGRES_URL && {
    dbCredentials: {
      url: process.env.POSTGRES_URL,
    },
  }),
});
