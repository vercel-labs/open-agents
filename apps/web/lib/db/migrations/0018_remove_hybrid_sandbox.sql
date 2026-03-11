UPDATE "user_preferences"
SET "default_sandbox_type" = 'vercel'
WHERE "default_sandbox_type" = 'hybrid';--> statement-breakpoint
UPDATE "sessions"
SET "sandbox_state" = jsonb_set("sandbox_state", '{type}', '"vercel"')
WHERE "sandbox_state"->>'type' = 'hybrid';
