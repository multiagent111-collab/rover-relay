# Vehicle and service selection — RELAY2-01

October 23, 2026, Codex. This generic, stateless optional service is developed in Relay2. The preserved original Relay judging checkout is unchanged. It is separate from the existing campus equipment application and does not reinterpret equipment missions as vehicle requests.

## Contract and behavior

`selection-1.0` accepts a bounded caller-supplied snapshot, requested service and optional vehicle type. Providers must explicitly match the service and vehicle constraint, be available, eligible, connected and observed within 60 seconds. Snapshots expire after 30 seconds; future clocks, duplicates, unknown fields and oversized sets reject. Retained heartbeat expiry can shorten the result lifetime. Options use deterministic provider-ID order; no nearest, cheapest or LLM ranking is claimed.

The ROVER gateway supplies and independently checks its current registry evidence. This public service does not establish source truth, production authorization, tenant membership or provider vetting. It accepts no SQL, arbitrary endpoint, user-identity claim, booking instruction or execution operation. Its output declares `execution=none`. Structured Observer/Filter/Ranker/Critic decision codes describe deterministic checks, not private reasoning or model calls.

## Run separately

Install with `npm.cmd ci` and build/test normally. Set a new server-only `RELAY2_SELECTION_TOKEN` of at least 32 characters, then:

```powershell
node --import tsx src/selection-server.ts
```

The default listener is `127.0.0.1:4193`; `RELAY2_SELECTION_PORT` selects another unused port. No environment file is implicitly loaded. Do not put the token in browser/Android source, Git or recordings. The calling backend uses the same private token. Remote deployment needs authenticated HTTPS/private transport. GET `/v1/health` is passive; POST `/v1/selection/shortlists` requires the dedicated bearer token.

No Nightshift, Zetaris, Docker, GPU, external model or H-MEM directory is required by this stateless selection service. The existing separate campus sample retains actual H-MEM. No runtime state or original Relay configuration was copied.

## Verification scope

All 120 application tests and the TypeScript/Vite production build passed after adding six selection checks. The tests cover filters, strict schema, expiry, clock bounds, duplicate IDs, request authentication and no execution. Actual loopback calls from the private Java integration additionally passed against this service; ROVER registry and Auth inputs in that run were controlled fixtures. This does not claim real provider acceptance, a real Supabase login, a live sponsor call or production deployment.

The private ROVER Android debug entry distinguishes backend-checked options from map discovery. No private ROVER implementation, credentials, traces or runtime data are included in Relay2.
