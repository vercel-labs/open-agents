ALTER TABLE "tasks" ADD COLUMN "cached_diff" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cached_diff_updated_at" timestamp;