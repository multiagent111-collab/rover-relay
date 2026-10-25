-- Apply only to your own standalone MiniROVER PostgreSQL database, after
-- starting Relay with DATABASE_URL so it initializes and seeds relay_state.
-- These are PostgreSQL source views, NOT Zetaris registration commands.
-- Existing JSON qualification/UTC projection fixes were inherited from the
-- October 21 integration and reviewed for RELAY-02 reproducible provisioning.
-- observed_at is when this SQL statement reads persisted SIMULATOR facts, not
-- a real provider heartbeat or the time those facts last changed. Do not wrap a
-- cached materialization with a new timestamp and claim its contents are fresh.
CREATE OR REPLACE VIEW relay_couriers_source AS
SELECT 'relay-demo'::text AS tenant_id,
       c->>'id' AS courier_id, c->>'name' AS courier_name,
       c->>'node' AS courier_node, (c->>'deliveryCents')::integer AS delivery_cents,
       (c->>'available')::boolean AS available,
       (c->>'version')::integer AS courier_version,
       (c->>'capacity')::integer AS capacity,
       c->>'supplierId' AS supplier_id,
       TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at,
       'relay_courier_postgres'::text AS courier_source
FROM relay_state s, LATERAL jsonb_array_elements(s.value->'fixtures'->'couriers') c
WHERE s.id=1;

CREATE OR REPLACE VIEW relay_route_edges_source AS
SELECT 'relay-demo'::text AS tenant_id,
       e->>'id' AS id, e->>'from' AS from_node, e->>'to' AS to_node,
       (e->>'minutes')::integer AS minutes, (e->>'closed')::boolean AS closed,
       (s.value->'fixtures'->>'revision')::integer AS version,
       TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
FROM relay_state s, LATERAL jsonb_array_elements(s.value->'fixtures'->'edges') e
WHERE s.id=1;
