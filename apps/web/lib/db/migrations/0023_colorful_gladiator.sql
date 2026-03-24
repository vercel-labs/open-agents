ALTER TABLE "sessions" ADD COLUMN "auto_create_pr_override" boolean;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "auto_create_pr" boolean DEFAULT false NOT NULL;