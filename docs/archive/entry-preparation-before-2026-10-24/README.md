# ROVER Relay

Relay helps a campus event coordinator find compatible replacement equipment before an event. It gathers bounded evidence, asks for missing constraints, proposes a checked plan and requires explicit approval before creating a **simulated** courier task. It remembers a confirmed delivery entrance with the real Meterless H-MEM engine.

The canonical request is two HDMI-USB-C adapters to the auditorium within 30 minutes, for $35 including delivery. Synthetic stock changes can invalidate a plan and require approval of a replacement.

## Run the CPU sample

Prerequisite: Node.js **22.13+** and npm. The current event candidate was tested with Node **26.2.0 on Windows**. The lockfile pins the dependency graph. A clone contains source and vendored H-MEM, not installed dependencies or build output.

```powershell
git clone https://github.com/multiagent111-collab/rover-relay.git
cd rover-relay
npm.cmd ci
npm.cmd run build
npm.cmd run local -- start --sample --service=relay --port=4183
```

Open <http://127.0.0.1:4183>. On macOS/Linux use `npm` in place of `npm.cmd`. These instructions apply to the reviewed event source candidate. Local event commits have **not been pushed by this task**; a remote clone must contain those commits before it reproduces the event features.

The sample needs no keys, Docker, GPU, private application or sponsor service. It uses synthetic fixtures, a deterministic Planner/Critic substitute, SQLite and the **actual pinned H-MEM engine**. Every task is simulated. Dependency installation needs npm registry access unless the exact packages are already cached. No `.env` is required. `.env.example` contains placeholders for optional live setup.

Run a separate sample directory if another instance already owns the default `.data/sample`. One application process may write each H-MEM directory.

```powershell
npm.cmd run local -- status --sample --service=relay --port=4183
npm.cmd run local -- stop --sample --service=relay --port=4183
```

Keep identical port/data flags for start/status/stop. Stop preserves mission history and memory. [Judge quickstart](docs/JUDGE_QUICKSTART.md) covers fresh scenarios, safe reset and troubleshooting. [Local services](docs/LOCAL_SERVICES.md) covers managed and external processes.

## Try the workflow

1. Confirm the auditorium entrance as **North loading entrance** in Memory.
2. Request the canonical mission. The restored sample selects **$32 / 22 minutes**. Inspect the receipt, source evidence and confirmed entrance.
3. In the demo controls, set Supplier A stock to zero before approving. The stale approval returns a conflict and produces plan version 2 at **$35 / 28 minutes**. Review and explicitly approve the replacement. Stock observations are never supplier reservations.
4. Use the simulator to accept, decline or cancel a task. A decline requires another plan and another approval. Task creation is never a real booking.
5. Restore demo fixtures for another canonical run. A **$30** budget produces an infeasible plan with a checked **$2** minimum increase for the original fixture. Restoring fixtures does not clear confirmed memory/history.

## Reproduce the evidence

```powershell
npm.cmd run verify:setup
npm.cmd test
npm.cmd run verify:hmem
npm.cmd run verify:baseline
npm.cmd run check:public
```

`verify:setup` reviews current tracked **and candidate untracked** files, exports their current bytes into a clean temporary directory, installs from the lockfile, builds, opens an actual loopback HTTP listener and exercises feasible/infeasible/disruption scenarios. It also runs seven measured scenarios including H-MEM behavior. It excludes private configuration/state and recorded historical artifacts, then closes/removes its own temporary stores/export. Use `-- --offline` only with a populated npm cache. Reports use new `.data/judge/relay-12-*.json` paths. No Docker or sponsor calls are involved.

The broader `npm.cmd run evaluate` additionally checks PostgreSQL using an isolated test database/container and requires Docker. Its optional live flag explicitly consumes provider quota. [Evaluation](docs/EVALUATION.md) separates measured offline, controlled, PostgreSQL and actual sponsor results.

## Current sponsor evidence

| Component             | Working feature and evidence                                                                                                                                                                 | Limit                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meterless H-MEM       | Confirmed entrance recall, correction and forgetting affect both model roles and approved task terms. [Memory safety](docs/MEMORY_SAFETY.md), 15 pinned source hashes and 13 upstream checks | Engine integration predates the event. Event work strengthens scope, restart and stale-approval safety                                              |
| Zetaris               | Real independent supplier SQLite HTTP and courier/route PostgreSQL federation, fixed read queries and source-specific evidence. [Provisioning](docs/SOURCE_EVIDENCE.md)                      | Campus business records are synthetic. Observation is not a reservation                                                                             |
| Nightshift and NVIDIA | RELAY-11 full planning mission took **39,917 ms**, with Planner Nemotron Super VL and Critic Nemotron Ultra. [Actual report](examples/recorded/relay-11-live-evaluation-2026-10-22.json)     | Routed Nemotron family explicitly accepted. Exact Lightning pinning unverified. Runtime receipt correlation is not independent provider attestation |
| Execution             | Durable local simulator and controlled public gateway conformance                                                                                                                            | No private ROVER job, provider acceptance, payment or real delivery                                                                                 |

RELAY-11 recorded **114 application tests, 14 actual PostgreSQL checks and 21 applicable public acceptance gates passing**. Three private ROVER gates remain deferred. These are dated results, not a claim that every environment will pass. No additional live sponsor call is necessary for offline setup.

## Design and dependencies

[Current architecture](docs/ARCHITECTURE.md) describes the React/Vite UI, Fastify API, TypeScript/Zod contracts, bounded Planner/Critic, deterministic validation and SQLite/PostgreSQL persistence. [Live setup](docs/SPONSOR_SETUP.md) explains separate vendor provisioning and your own credentials. Public source templates live under `db/`; no sponsor platforms or NVIDIA weights are bundled.

The official H-MEM source is unmodified at `1742dec56a66e58eef9dda2d2b865823758ca8cd`, with Apache-2.0 license and [attribution](THIRD_PARTY_NOTICES.md). Runtime does not download it. No application license has been selected on the owner's behalf.

## Final local review

[Submission packet](docs/SUBMISSION_PACKET.md), [final source/evidence review](docs/FINAL_REVIEW.md), and [dependency metadata](docs/DEPENDENCIES.md). Participant-confirmed team: **Autonomous Multi-Agents for Real-time GPS Services**. Selected primary track: **Wildcard**. Features are frozen; final recording, owner license choice, exact public event-source publication and participant submission remain pending.

## Event materials and provenance

[Demo storyboard and recording instructions](docs/DEMO.md), [deck](docs/demo/relay-12-deck.pptx), [new-work record](docs/DEVELOPMENT_LOG.md), and [current submission requirements](docs/HACKATHON_REQUIREMENTS.md).

The entire protected tag `rover-relay-pre-event-2026-10-21` at `1b19c528d639134691289d9c0db38d82e9f277ff` is prior work. [PRIOR_WORK.md](docs/PRIOR_WORK.md) and [BASELINE.md](docs/BASELINE.md) are immutable historical disclosures. Later inherited integration hunks retain their recorded provenance. Event tickets in this session use **Codex**, under the user's updated any-agent rule. No Cursor use is claimed. Private ROVER integration remains future work and is not a dependency.

The deck and storyboard are local review materials. A final 1–4 minute recording, participant roster/form review and submission remain pending. No upload, deployment, publication or submission is implied.
