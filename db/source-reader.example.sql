-- Fresh, OWN standalone Relay database only. Inspect existing roles/ACLs first;
-- reuse an existing restricted reader rather than blindly rerunning CREATE ROLE.
-- Run with psql as the database owner after source-views.sql.
-- Set psql variable reader_password privately, outside tracked files/history.
CREATE ROLE relay_source_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE relay TO relay_source_reader;
GRANT USAGE ON SCHEMA public TO relay_source_reader;
REVOKE ALL ON public.relay_state FROM relay_source_reader;
REVOKE ALL ON public.relay_couriers_source, public.relay_route_edges_source
  FROM relay_source_reader;
GRANT SELECT ON public.relay_couriers_source, public.relay_route_edges_source
  TO relay_source_reader;

-- PUBLIC grants or role memberships can confer additional privileges. Inspect
-- them and verify effective access; GRANT SELECT alone is not proof of isolation.
SELECT has_table_privilege('relay_source_reader','public.relay_state','SELECT') AS raw_select,
       has_table_privilege('relay_source_reader','public.relay_state','INSERT,UPDATE,DELETE,TRUNCATE') AS raw_write,
       has_schema_privilege('relay_source_reader','public','CREATE') AS can_create;
-- All three must be false. Reader must select the two projections and must have
-- no write privileges on either. Never grant it membership in the app/admin role.
