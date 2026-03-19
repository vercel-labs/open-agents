CREATE TABLE "vercel_project_links" (
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text NOT NULL,
	"team_id" text,
	"team_slug" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vercel_project_links_user_id_repo_owner_repo_name_pk" PRIMARY KEY("user_id","repo_owner","repo_name")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "vercel_project_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "vercel_project_name" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "vercel_team_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "vercel_team_slug" text;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD CONSTRAINT "vercel_project_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;