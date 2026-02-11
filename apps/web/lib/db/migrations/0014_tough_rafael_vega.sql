CREATE TABLE "chat_reads" (
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reads_user_id_chat_id_pk" PRIMARY KEY("user_id","chat_id")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "default_sandbox_type" SET DEFAULT 'vercel';--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "last_assistant_message_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;