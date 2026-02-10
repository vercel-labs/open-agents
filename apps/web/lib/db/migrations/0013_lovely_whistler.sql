CREATE TABLE "github_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"installation_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "active_stream_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "lifecycle_state" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "lifecycle_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "sandbox_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "hibernate_after" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "lifecycle_run_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "lifecycle_error" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_user_installation_idx" ON "github_installations" USING btree ("user_id","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_user_account_idx" ON "github_installations" USING btree ("user_id","account_login");
