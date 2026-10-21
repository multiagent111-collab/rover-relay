-- Apply only to your own standalone MiniROVER PostgreSQL database, after
-- starting Relay with DATABASE_URL so it initializes and seeds relay_state.
-- These are PostgreSQL source views, NOT Zetaris registration commands.
CREATE OR REPLACE VIEW relay_couriers_source AS
SELECT 'relay-demo'::text AS tenant_id,
       c->>'id' AS courier_id, c->>'name' AS courier_name,
       c->>'node' AS courier_node, (c->>'deliveryCents')::integer AS delivery_cents,
       (c->>'available')::boolean AS available,
       (c->>'version')::integer AS courier_version,
       (c->>'capacity')::integer AS capacity,
       c->>'supplierId' AS supplier_id,
       CURRENT_TIMESTAMP AS observed_at,
       'relay_courier_postgres'::text AS courier_source
FROM relay_state, LATERAL jsonb_array_elements(value->'fixtures'->'couriers') c
WHERE relay_state.id=1;

CREATE OR REPLACE VIEW relay_route_edges_source AS
SELECT 'relay-demo'::text AS tenant_id,
       e->>'id' AS id, e->>'from' AS from_node, e->>'to' AS to_node,
       (e->>'minutes')::integer AS minutes, (e->>'closed')::boolean AS closed,
       (value->'fixtures'->>'revision')::integer AS version,
       CURRENT_TIMESTAMP AS observed_at
FROM relay_state, LATERAL jsonb_array_elements(value->'fixtures'->'edges') e
WHERE relay_state.id=1;
