-- Auth gate, part 2 of 2 (LOCK-DOWN — apply ONLY after the auth code is deployed AND sign-in is
-- verified working). Strips all data access from `anon`, so a request without a valid session
-- cookie (→ empty bearer → anon role) can read/write nothing. Applying this before the auth code
-- is live would break the currently-deployed app (which runs as anon). See _auth_grants.sql.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
