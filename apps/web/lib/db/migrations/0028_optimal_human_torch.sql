CREATE TABLE "workflow_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp NOT NULL,
	"duration_ms" integer NOT NULL,
	"finish_reason" text,
	"raw_finish_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text,
	"status" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp NOT NULL,
	"total_duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_run_steps_run_id_idx" ON "workflow_run_steps" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_steps_run_step_idx" ON "workflow_run_steps" USING btree ("workflow_run_id","step_number");--> statement-breakpoint
CREATE INDEX "workflow_runs_chat_id_idx" ON "workflow_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_session_id_idx" ON "workflow_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_user_id_idx" ON "workflow_runs" USING btree ("user_id");