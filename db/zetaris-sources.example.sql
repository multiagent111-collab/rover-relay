-- Run complete statements individually against your own local Zetaris instance.
-- Registration statements are inherited October 21 integration work, reviewed
-- and packaged for RELAY-02. They are not newly executed by application startup.
-- Existing Relay objects must be inspected before reusing these names.
-- Provision the independent simulator PostgreSQL database and source views first.
-- relay_source_reader must have SELECT only on the two source views.
-- Replace the password placeholder privately; never commit the filled-in SQL.
CREATE DATASOURCE relay_courier_pg DESCRIBE BY "Relay courier simulator read only" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://relay-courier-source:5432/relay",
  username "relay_source_reader",
  password "REPLACE_WITH_PRIVATE_READER_PASSWORD",
  fetchsize "100"
);

REGISTER DATASOURCE TABLE "relay_couriers_source" FROM relay_courier_pg;
REGISTER DATASOURCE TABLE "relay_route_edges_source" FROM relay_courier_pg;

CREATE LIGHTNING DATABASE RELAY_SUPPLIER DESCRIBE BY "Relay independent SQLite supplier HTTP source";
CREATE LIGHTNING REST TABLE inventory_raw FROM RELAY_SUPPLIER REQUEST (
  endpoint "http://host.docker.internal:4174/inventory",
  method "get", response_type "json", http_encoding "URLENCODED"
) HEADER (user-agent "rover-relay-local-demo") BODY ();

CREATE SCHEMASTORE CONTAINER rover_relay;
