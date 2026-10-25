-- Inherited October 21 definitions, reviewed/packaged for RELAY-02.
-- Inspect existing definitions first; execute only in your own isolated setup.
-- Preserve tenant_id and source-observed timestamps through these projections.
-- Flatten supplier inventory
CREATE OR REPLACE SCHEMASTORE VIEW supplier_inventory WITH CONTAINER rover_relay AS
SELECT s.tenant_id, s.supplier_id, s.supplier_name, s.sku, s.stock,
       s.unit_price_cents, s.pickup_node, s.handling_minutes, s.supplier_version,
       s.observed_at, s.supplier_source
FROM RELAY_SUPPLIER.inventory_raw LATERAL VIEW explode(data) AS s;

-- Federate suppliers and couriers inside Zetaris
CREATE OR REPLACE SCHEMASTORE VIEW relay_candidates WITH CONTAINER rover_relay AS
SELECT s.tenant_id, s.supplier_id, s.supplier_name, s.sku, s.stock,
       s.unit_price_cents, s.pickup_node, s.handling_minutes, s.supplier_version,
       c.courier_id, c.courier_name, c.courier_node, c.delivery_cents, c.available,
       c.courier_version, c.capacity, s.supplier_source, c.courier_source,
       s.observed_at AS supplier_observed_at, c.observed_at AS courier_observed_at
FROM rover_relay.supplier_inventory s
JOIN relay_courier_pg.relay_couriers_source c
ON s.supplier_id = c.supplier_id AND s.tenant_id = c.tenant_id;

-- Expose route graph
CREATE OR REPLACE SCHEMASTORE VIEW relay_route_edges WITH CONTAINER rover_relay AS
SELECT tenant_id, id, from_node, to_node, minutes, closed, version, observed_at
FROM relay_courier_pg.relay_route_edges_source;
