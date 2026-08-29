-- This migration consolidates three earlier unmerged branch migrations
-- (0037_classy_vengeance, 0038_salty_squirrel_girl, 0039_skinny_hercules).
-- Preview databases persist across deploys of the same branch and may have
-- already applied the originals, so every statement must be idempotent.
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "harness_id" text DEFAULT 'open-agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "harness_session_state" jsonb;--> statement-breakpoint
-- Clean up the dead column the replaced 0038 added on preview databases.
-- No-op everywhere else; the column never reached production.
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "active_harness_run_id";
