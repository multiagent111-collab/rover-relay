# ROVER Relay

Relay is an agent architecture and standalone web application demonstrated inside the existing proprietary ROVER Android platform. The Wildcard [Tinkerer] entry adds confirmed context, federated provider review and inspectable agent behavior to a vehicle/service workflow. ROVER's broader hailing, map, messaging and multimedia interfaces are declared existing platform work.

This repository contains **standalone Relay and generic integration services/contracts**. It does not contain ROVER Android/backend implementation, credentials or runtime state. The browser sample is a campus-equipment scenario, not a copy of the native fleet UI.

## Run locally without ROVER

Node.js 22.13+ and npm are required. From this source directory:

```powershell
npm.cmd ci
npm.cmd run build
$env:RELAY_JUDGE_PORT = '4213'
$env:RELAY_JUDGE_DATA_DIR = '.data/entry-judge'
node --import tsx scripts/judge-local.ts
```

Open <http://127.0.0.1:4213/?venue=auditorium>. Stop with Ctrl+C. On macOS/Linux use `npm` and prefix the last command with `RELAY_JUDGE_PORT=4213 RELAY_JUDGE_DATA_DIR=.data/entry-judge` instead of the PowerShell environment assignments.

The launcher explicitly chooses OFFLINE SAMPLE and does not load `.env`. Actual official Meterless H-MEM stores confirmed context. Planner/Critic output, data, prices, routes and dispatch are deterministic/synthetic in this mode. No Docker, GPU, sponsor credentials, Android or rented server is needed for that sample. A real sponsor route needs separate setup and credentials.

## Current entry and evidence

- [Current entry and proprietary-host disclosure](docs/HACKATHON_ENTRY.md)
- [Judge quickstart](docs/JUDGE_QUICKSTART.md)
- [Submission packet](docs/SUBMISSION_PACKET.md)
- [Short demo script](docs/DEMO.md)
- [Current requirements](docs/HACKATHON_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md), [generic contracts](contracts/), [H-MEM service](docs/ROVER_MEMORY_SERVICE.md)
- [Optional live sponsor setup](docs/SPONSOR_SETUP.md) and [source federation](docs/SOURCE_EVIDENCE.md)
- [Historical measured public evaluation](docs/EVALUATION.md)

The October 24 native checkpoint records 109 backend tests, 147 Relay2 tests, actual H-MEM influence and all four optional-service combinations passing. That native result belongs to the separately recorded proprietary host integration; it is not a claim that this standalone sample creates real vehicle bookings. See the entry evidence for exact scope and freshness/recovery limits.

## Public repository status

Intended public repository: <https://github.com/multiagent111-collab/rover-relay>. At packaging, public main still pointed to the declared pre-event baseline. The reviewed entry source copy and publication patch are prepared locally; do not infer that unpublished event work is already on public main. Once the owner publishes it, record the actual public commit in the submission.

## Verification and provenance

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run verify:hmem
```

Source enumeration/evaluation helpers that call Git require a Git checkout. The complete pre-event tag `rover-relay-pre-event-2026-10-21` at `1b19c528d639134691289d9c0db38d82e9f277ff` remains declared prior work, including initial planning/adapters and H-MEM integration. [PRIOR_WORK.md](docs/PRIOR_WORK.md) is an immutable historical baseline disclosure. Later integration records do not reclassify inherited code as new. Development used Codex; Cursor is optional under the current event rules.

Official H-MEM is pinned at `1742dec56a66e58eef9dda2d2b865823758ca8cd`, with its upstream Apache-2.0 license and [third-party notices](THIRD_PARTY_NOTICES.md). No new application license is selected here. ROVER remains proprietary. The rule asking for all source still needs organizer clarification for the proprietary host/private glue boundary. No public push, video upload, deployment or submission is implied by this local preparation.
