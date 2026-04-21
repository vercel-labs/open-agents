-- backfill better-auth accounts for existing vercel users
-- access_token and refresh_token are left NULL — fresh tokens come from re-login
-- account_id = vercel external_id (sub) — this is how better-auth matches returning users
INSERT INTO accounts (id, account_id, provider_id, user_id, scope, created_at, updated_at)
SELECT
  md5('vercel:' || external_id),
  external_id,
  'vercel',
  id,
  scope,
  created_at,
  updated_at
FROM users
WHERE provider = 'vercel'
ON CONFLICT (id) DO NOTHING;
