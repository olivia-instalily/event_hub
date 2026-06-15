-- service_role has BYPASSRLS but is not a superuser, so it still needs table GRANTs.
-- Server-side writers (the attach-luma function, the Luma sync script) act as service_role.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;
