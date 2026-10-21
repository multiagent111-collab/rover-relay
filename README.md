# ROVER Relay

**Pre-event baseline for Open Agent Hackathon 2026.** All code in [`rover-relay-pre-event-2026-10-21`](https://github.com/multiagent111-collab/rover-relay/tree/rover-relay-pre-event-2026-10-21) predates the build opening on **October 21, 2026, 5:00 p.m. PDT / October 22, 00:00 UTC**. Declare it as existing work in Wildcard [Tinkerer]. This is a baseline, not a completed hackathon submission. See [baseline evidence](docs/BASELINE.md), [prior work](docs/PRIOR_WORK.md), and [remaining submission requirements](docs/HACKATHON_REQUIREMENTS.md).

A standalone campus equipment rescue agent. Relay compares supplier stock and courier routes, produces an evidence-backed delivery proposal, remembers confirmed entrance instructions, and creates a durable **simulated** dispatch task after approval.

This first iteration is independent of the private ROVER platform. No ROVER source, database, credentials, Android build, or private package is required.

## Start locally

Install Node.js **22.13 or newer** (Node 24 LTS recommended). This iteration was built and tested on Node 26.2.0 on Windows. Node's built-in SQLite supports the default persistence; some Node releases print an experimental-feature warning.

```powershell
git clone https://github.com/multiagent111-collab/rover-relay.git
cd rover-relay
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open [Relay](http://127.0.0.1:4173). No keys, external services, Docker, or local GPU are needed for the default offline sample. The delivered directory includes installed dependencies and a built interface; on this machine you can start with `npm.cmd start`.

The default is `SAMPLE_MODE=true`. A clean clone needs no credentials. Optional configuration:

```powershell
Copy-Item .env.example .env
```

In sample mode the backend makes no external model or data calls. Browser requests go only to the local Relay server. Meterless H-MEM is the real upstream engine, and mission/task persistence and validation are real application code. Planner and Critic are explicitly labeled deterministic sample substitutes. Supplier/courier facts, travel times, prices, and operations are synthetic. Inventory is observed, not reserved.

## Try the complete workflow

1. Save an entrance preference, such as **North loading entrance**.
2. Request two adapters for the auditorium, $35 total, within 30 minutes. The initial checked option costs **$32**, with a **22-minute** synthetic travel estimate.
3. Open **Evidence & agent steps** to inspect context, proposal, critique, and deterministic validation.
4. Use **Campus Tech runs out**, then try approving the old plan. Relay rejects it and creates a fresh proposal using Library AV, initially $35 and 28 minutes.
5. Approve the current proposal. The dispatch desk shows one durable task. Acceptance, decline, progress, and completion are explicit simulator actions.
6. Try a new request with a **$30 budget** and restored stock. Relay returns an infeasible result and calculates the **$2** additional budget needed among the checked options.
7. Restart the server to verify stored missions and confirmed memory survive. Change or forget an entrance preference to verify the old value is excluded from future retrieval.

Approvals expire after 60 seconds by default. A mission's absolute deadline does not reset on replan. A changed source or preference requires renewed approval. Retried identical approvals return the same task ID.

## Included in iteration one

- Minimal React workspace with campus schematic, comparisons, evidence, disruption controls, recent missions, and dispatch desk.
- Shortest-path routing, exact item matching, stock, capacity, budget, deadline, and availability validation.
- Computed budget and time alternatives within the checked options.
- Separately invoked Planner/Critic contracts, feedback, and a three-round limit.
- Official Meterless H-MEM source pinned at `1742dec56a66e58eef9dda2d2b865823758ca8cd`, with durable confirmed preferences and audit records.
- SQLite default storage and an optional PostgreSQL adapter; task creation, reservation, idempotency, and outbox are atomic.
- A separate, independently persisted supplier HTTP source for subsequent Zetaris registration.
- Nightshift and Zetaris HTTP adapters, typed result parsing, bounded responses, freshness checks, fixed SQL templates, and controlled errors.
- Versioned public contracts for future private ROVER integration.
- Tests, actual recorded offline runs, preflight, Docker packaging, and sponsor setup instructions.

## Validation

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preflight
npm.cmd run examples
```

The automated suite covers the normal workflow, source changes, expiry, bounded model failures, idempotency, recovery, state transitions, identity isolation, H-MEM persistence/correction/forgetting, offline execution, and sponsor HTTP contracts using controlled test responses.

`examples/recorded/` contains three actual **offline sample** runs: feasible, infeasible, and disruption/replan, plus JSONL event evidence. They do not demonstrate live sponsor calls. `npm run examples` regenerates them in a temporary database without modifying your demo state.

Docker sample option:

```powershell
docker compose --profile sample up --build
```

This profile does not start or configure sponsor services. Docker's daemon must be running. The Compose sample configuration was validated; the image and containers have not been executed in this environment.

## Live sponsor setup

See [credential acquisition and connection checks](docs/LIVE_CONNECTIONS.md). Official H-MEM source integrity and all 13 upstream conformance checks can be verified offline with `npm.cmd run verify:hmem`. Use `npm.cmd run preflight:live -- --component=inference` or `--component=zetaris` to check services independently. The default inference provider is Nightshift; explicit `RELAY_INFERENCE_PROVIDER=nvidia` enables NVIDIA-direct development calls without automatic fallback. Receipts always identify the selected path.

Read [docs/SPONSOR_SETUP.md](docs/SPONSOR_SETUP.md). Configure `.env`, set `SAMPLE_MODE=false`, provide a separate Relay access token and your service settings, then run preflight.

The intended live path is **Relay → Meterless Nightshift → NVIDIA Nemotron**, with actual Zetaris federation and real H-MEM. Live mode fails on missing configuration rather than switching to sample responses. Sponsor calls still operate on synthetic sources and the MiniROVER simulator.

No live Zetaris instance, Nightshift token, or NVIDIA account was configured during this iteration. Those adapters have contract tests but remain unverified against your running services. A configured model name is not proof of actual Nemotron inference; correlate Runtime receipts to the underlying model. Cursor development has not been claimed: this iteration was authored with Codex.

## Project layout

See the [architecture diagram](docs/ARCHITECTURE.md) for the sample and live-service boundaries.

```text
src/                 API, domain checks, agents, adapters, dispatch service
ui/                  New React interface and SVG campus schematic
vendor/hmem/         Pinned official H-MEM source and Apache license
supplier-fixtures/   Independent supplier HTTP source and persistence
db/                  Optional PostgreSQL source views
contracts/           OpenAPI and integration boundary documentation
tests/               Behavior and adapter boundary tests
scripts/             Preflight, examples, and H-MEM source provisioning
examples/recorded/   Actual sample run outputs and evidence
docs/                Setup, architecture, prior work, and development record
```

Default state is under `.data/` and excluded from Git. Run only one Relay application process per data directory: the reference H-MEM engine is a local JSON store without a cross-process locking or crash-atomic persistence guarantee. PostgreSQL uses a row-locked JSON aggregate for this small simulator, rather than ROVER's production schema. It is an integration starting point, not a production dispatch service.

Authentication is intentionally limited: sample mode has two documented local identities, `coordinator` and `reviewer`, selected by `X-Relay-Demo-User`; these are test identities, not secure accounts. Live mode requires a server-configured bearer token and maps it to a single disclosed demo tenant/user. A real deployment needs production authentication, permissions, rate limiting, and supplier/provider reservation protocols.

The app binds to `127.0.0.1` by default. Keep this preview local. No real purchases, bookings, payments, provider notifications, or physical deliveries occur.

## Later ROVER integration

Implement the public `DispatchPort` against a private authenticated ROVER gateway; replace the simulator in that configuration. Keep real identity, job lifecycle, acceptance, and payment authority in ROVER. The public contracts include mission input, decision receipts, plan versions/digests, stable task IDs, and idempotency. Do not copy the ROVER application or database schema into this repository. See [contracts/README.md](contracts/README.md).

This baseline includes work from **October 20-21, 2026, before the hackathon build window**. Disclose the entire tagged baseline as pre-existing work. See [docs/PRIOR_WORK.md](docs/PRIOR_WORK.md). The public repository provides source for review; no hackathon submission is implied. No open-source license has been selected for Relay-authored code, so its owner retains all rights. Included H-MEM code retains its upstream Apache-2.0 license and notices.
