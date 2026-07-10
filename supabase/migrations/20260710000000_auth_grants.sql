-- Auth gate, part 1 of 2 (ADDITIVE — safe to apply before the auth code deploys).
-- Grants the `authenticated` role the same data privileges the app needs, so signed-in sessions
-- (JWT role=authenticated) work once the auth code is live. This does NOT touch `anon`, so the
-- currently-deployed app (which runs as anon) keeps working — zero downtime.
-- The lock-down (REVOKE from anon) is a separate migration (…_auth_revoke_anon.sql) applied AFTER
-- deploy + sign-in verification.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
