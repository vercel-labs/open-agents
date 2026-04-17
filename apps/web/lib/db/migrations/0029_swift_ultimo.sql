CREATE TABLE "mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"transport_type" text DEFAULT 'http' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"oauth_scopes" text,
	"oauth_client_id" text,
	"oauth_client_secret" text,
	"custom_headers" jsonb,
	"enabled_by_default" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text,
	"provider" text NOT NULL,
	"code_verifier" text NOT NULL,
	"redirect_to" text DEFAULT '/settings/connections' NOT NULL,
	"oauth_client_id" text,
	"oauth_client_secret" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "enabled_mcp_connection_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_states" ADD CONSTRAINT "mcp_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_connections_user_id_idx" ON "mcp_connections" USING btree ("user_id");