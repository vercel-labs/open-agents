CREATE TABLE "task_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"repo_owner" text,
	"repo_name" text,
	"branch" text,
	"clone_url" text,
	"sandbox_id" text,
	"lines_added" integer DEFAULT 0,
	"lines_removed" integer DEFAULT 0,
	"pr_number" integer,
	"pr_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;