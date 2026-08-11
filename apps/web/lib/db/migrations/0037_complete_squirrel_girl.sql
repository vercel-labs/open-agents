ALTER TABLE "chats" ADD COLUMN "harness_id" text DEFAULT 'open-agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "harness_session_state" jsonb;