CREATE TABLE "cli_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"token_hash" text NOT NULL,
	"encrypted_access_token" text,
	"device_name" text,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"device_code" text,
	"user_code" text,
	"device_code_expires_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"workspace_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_tokens_token_hash_idx" ON "cli_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_tokens_device_code_idx" ON "cli_tokens" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_tokens_user_code_idx" ON "cli_tokens" USING btree ("user_code");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_accounts_provider_external_workspace_idx" ON "linked_accounts" USING btree ("provider","external_id","workspace_id");