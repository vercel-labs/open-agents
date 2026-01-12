ALTER TABLE "tasks" ADD COLUMN "snapshot_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "snapshot_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "snapshot_size_bytes" integer;