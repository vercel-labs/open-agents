ALTER TABLE "linked_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "linked_accounts" CASCADE;--> statement-breakpoint
DROP INDEX "users_provider_external_id_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "external_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "refresh_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "token_expires_at";