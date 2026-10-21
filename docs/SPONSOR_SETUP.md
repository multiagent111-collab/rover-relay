# Sponsor service setup

Start with [LIVE_CONNECTIONS.md](LIVE_CONNECTIONS.md) for current download links, credential acquisition and independent connection checks. The October 21 Zetaris bundle replaces the old Freemium Docker Hub installation recipe for this route.

The runnable default is offline sample mode. The live HTTP adapters are implemented and tested against controlled responses, but actual sponsor access was not available during iteration one. Do not claim live integration success until preflight and a complete mission both succeed with your services.

## Meterless H-MEM

The official source is included under `vendor/hmem/`, unmodified, at revision `1742dec56a66e58eef9dda2d2b865823758ca8cd`. No engine download is needed for a fresh clone. The wrapper instantiates the real `HMEM` facade and uses `MemoryStoreService`, `MemoryRetrievalService`, and `TrustLedgerService` through it.

Storage is partitioned by hashed tenant/user and venue. Explicit confirmation creates a long-term preference. Correction deletes superseded preferences from retrieval while retaining the upstream deletion audit. Forgetting removes the preference's content from active memory; the local audit ledger retains its prior value for evidence. This is not a promise to erase audit history. No inferred supplier stock or courier availability becomes durable memory.

Retrieved structured records and the engine's context block are passed to both model roles. The chosen entrance is also copied into the approved simulated task. State and audit files persist under `.data/hmem/`. Use one application process for this reference implementation.

To re-provision the exact source if needed, use `npm run setup:hmem`. It requires network access and preserves the pinned revision and license. The application does not perform this download during execution. [Official starter](https://github.com/Meterless/Meterless/tree/main/templates/agentathon-starter).

## Nightshift and NVIDIA

Nightshift remains the default. `RELAY_INFERENCE_PROVIDER=nvidia` explicitly selects the new NVIDIA-direct development route using `NVIDIA_API_KEY` and `NEMOTRON_MODEL`. Receipts identify this as `nvidia-direct`; it is not a Nightshift success claim. No automatic provider fallback occurs. Confirm submission-rule acceptance separately.

1. Install and configure the organizer-supported Nightshift Runtime separately. This application does not redistribute Nightshift.
2. Add your NVIDIA provider key inside Nightshift and configure a Nemotron-backed lane. The initial candidate model is `nvidia/nemotron-3.5-lightning-30b-a3b`, subject to account access and Runtime support.
3. Take the real Runtime URL and access token from its Console; put them in the server's private `.env` as `METERLESS_BASE_URL` and `METERLESS_RUNTIME_TOKEN`.
4. Set `METERLESS_ROUTE` to an actual discovered `meterless/*` route backed by that lane. Set `NEMOTRON_MODEL` as the expected model label for your evidence record. The label itself does not configure the lane.
5. Set a separate `RELAY_ACCESS_TOKEN` of at least 24 characters for access to Relay's live API. This is not a Nightshift token or an NVIDIA key. The browser's connection form uses only the Relay token.
6. Run `npm run preflight` in live mode. Discovery alone is insufficient: the script also requests actual inference.

Relay sends bearer authorization, `meterless-app: rover-relay`, and `meterless-scope: user` on chat. It accepts the normal base URL forms without duplicating `/v1`, sets timeouts, limits output bytes, and parses JSON through application schemas. Bad authentication, network failures, invalid output, and missing configuration remain distinct errors.

Capture the Runtime request ID and underlying provider/model receipt during a real mission. A `meterless/auto` response or the `NEMOTRON_MODEL` setting alone cannot prove Nemotron was used. The UI displays response-reported model identity, which may itself be a route. No silent direct-provider fallback is implemented.

[Meterless Runtime contract](https://meterless.ai/engines.html) · [NVIDIA API example](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/build)

## Zetaris

Follow the [pinned official client setup](https://github.com/zetaris/getting-started/blob/44668b267ad7ee0fae25ce7588e9620121d47cae/docs/connections/client-setup.md). Obtain the actual event/local instance and its supported connectors. This iteration implements direct REST, not the UI proxy or JDBC bridge.

The implemented request uses the pinned starter's `/api/v1.0/sql-editor/sqls/run` contract: bearer API key, numeric `X-Org-ID`, UUID `X-Request-ID`, and a JSON body containing `queryId`, `sql`, `source`, and `limit`. Verify this against your running instance's OpenAPI specification. A contract mismatch must be corrected in the adapter, not hidden by returning sample data.

Provision two genuinely independent data sources:

- **Courier and route source:** your standalone MiniROVER PostgreSQL database. Start Relay with `DATABASE_URL` first so it initializes the simulator; apply `db/source-views.sql` to that database to expose read views.
- **Supplier source:** run `npm run supplier`. Its `/inventory` endpoint uses its own SQLite file, separate from Relay's database. Register it using a supported Zetaris REST connector, or adapt to another independently stored source supported by the event instance. The HTTP response is `{ "data": [ ...supplier records... ] }`.

Do not expose a laptop-only URL and assume Zetaris can reach it. Host, container, and remote-instance addresses differ; choose an endpoint reachable by the actual Zetaris instance. Configure a dedicated read-only database role for the courier/route views.

Create team-scoped Zetaris views named by `ZETARIS_CANDIDATE_VIEW` and `ZETARIS_ROUTE_VIEW`. Exact registration and view creation depend on your instance and permissions. Preview any DDL and follow the upstream shared-instance approval requirements. No shared-instance objects are created by this project automatically.

The candidate view must perform the supplier/courier join **inside Zetaris**, on `supplier_id` and `tenant_id`, with this projection:

```text
tenant_id
supplier_id, supplier_name, sku, stock, unit_price_cents, pickup_node,
handling_minutes, supplier_version,
courier_id, courier_name, courier_node, delivery_cents, available,
courier_version, capacity,
supplier_source, courier_source,
supplier_observed_at, courier_observed_at
```

Use each source's `observed_at` for the corresponding projected timestamp. The supplier and courier source aliases must be distinct. A courier's `supplier_id` describes the simulator's supported pickup corridor. Each courier has one corridor in this iteration.

The route view must expose:

```text
tenant_id, id, from_node, to_node, minutes, closed, version, observed_at
```

Source IDs should match the included campus node IDs. Return ISO 8601 timestamps with timezone. Numeric strings and exponent notation are converted and validated; booleans accept JSON booleans or `"true"`/`"false"`. Observations older than 60 seconds or more than five seconds in the future are rejected. Missing required fields fail schema validation. Cached source timestamps must reflect the real observation time rather than a fabricated refresh time.

The adapter executes fixed read templates with a hardcoded disclosed demo tenant, bounded view identifiers, a 100-row limit, timeout, and bounded HTTP response. Hitting the limit is an explicit error rather than treating a truncated set as complete. Model-generated SQL is never executed.

Keep query IDs, source aliases, and the connector/query evidence proving that the candidate query reaches both sources. Distinct aliases in a returned row are useful references but not independent proof of federation. The wrapper does not invent platform-provided row-level lineage.

## PostgreSQL and Docker option

The simplest live setup is to run the app on the host with a separately running PostgreSQL instance and configure `DATABASE_URL`. The local sample remains SQLite-based when that setting is blank.

An optional `compose.live.yaml` starts the simulator PostgreSQL database, Relay, and the independent supplier source. It does not install or start Zetaris or Nightshift. Copy `.env.example` to `.env`, supply all sponsor settings and `POSTGRES_PASSWORD` (use a URL-safe value for the provided connection URI), and run:

```powershell
docker compose -f compose.live.yaml up --build
```

In this configuration the application container reaches Windows-host services through `host.docker.internal`, not its own `127.0.0.1`. Set the actual Runtime and Zetaris URLs accordingly. An organizer-hosted Zetaris instance needs a separately reachable supplier endpoint.

The PostgreSQL adapter and container image are supplied but not execution-tested here because the Docker Linux daemon was not running. Contract/behavior tests executed with SQLite; validate PostgreSQL transactions, image startup, network paths, connector setup, and real sponsor calls before using the live profile for judging.

## Cursor

Open the standalone Relay folder in Cursor. Use `AGENTS.md` and `.cursor/rules/relay-boundaries.mdc` for project constraints. Record actual implementation, debugging, review, and test work in `docs/DEVELOPMENT_LOG.md`. This initial iteration was authored in Codex and is not evidence of prior Cursor use.
