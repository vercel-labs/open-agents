ALTER TABLE "tasks" ADD COLUMN "sandbox_state" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "sandbox_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "sandbox_created_at";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "sandbox_timeout";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "vercel_status";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "vercel_started_at";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "vercel_error";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "just_bash_snapshot";