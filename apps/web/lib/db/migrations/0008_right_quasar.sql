ALTER TABLE "tasks" ADD COLUMN "vercel_status" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "vercel_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "vercel_error" text;