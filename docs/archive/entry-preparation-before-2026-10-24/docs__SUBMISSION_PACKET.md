# Relay submission packet

Local review candidate prepared with Codex for RELAY-13. **This is not a submitted entry.** Features are frozen. Final video, public event-source publication and participant form completion remain outstanding.

## Participant details

| Field           | Value and evidence                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project title   | ROVER Relay                                                                                                                                                            |
| Team            | **Autonomous Multi-Agents for Real-time GPS Services**                                                                                                                 |
| Primary track   | **Wildcard**; the public event page labels this Wildcard [Tinkerer]                                                                                                    |
| Confirmation    | Team name and selected track supplied directly by the participant during RELAY-13. No account/team setting was changed or independently authenticated here             |
| Team membership | Earlier notes describe one member; current roster and first-submission lock state still need participant review                                                        |
| Deadline        | **October 27, 2026, 23:45 UTC / 4:45 p.m. PDT**, rechecked on the [official event page](https://hackathon.genai.works/event/open-agent-hackathon-2026) during RELAY-13 |

The expanded public rules still contain Cursor-specific wording, while the participant supplied an updated any-agent rule and a working Meterless Engine requirement. This work uses **Codex**. Preserve the organizer update when completing the form; never claim Cursor usage or credit redemption. [Requirements and the recorded conflict](HACKATHON_REQUIREMENTS.md). Account-specific field names, character limits and upload formats have not been authenticated or verified.

## Suggested submission text

### Short description

ROVER Relay helps a campus event coordinator obtain compatible replacement equipment before an event. It combines source evidence and confirmed entrance memory into a checked delivery plan, then requires human approval before a simulated courier task. Changed stock, routes or courier availability trigger a fresh plan and approval.

### Problem and target user

A coordinator needs two HDMI-USB-C adapters at the auditorium within 30 minutes, with a $35 total budget including delivery. Supplier availability, courier capacity and routes can change between planning and action. Relay makes those constraints and changes visible. The demonstration uses synthetic campus records; no measured customer outcome or real delivery is claimed.

### Solution and agent behavior

Relay confirms missing request facts, chooses from bounded evidence-read tools, and separates Planner proposals from Critic review. Deterministic code checks integer-cent arithmetic, routes, capacity, deadlines and cited observations. A versioned receipt binds the selected supplier/courier and confirmed entrance. Approval revalidates current evidence, memory and expiry. Changes invalidate approval rather than silently relaxing constraints or allocating another task.

The offline sample uses a deterministic model substitute and actual official H-MEM on CPU. Live mode uses separately provisioned Zetaris and an explicitly selected inference adapter. Idempotency, atomic task reservation and a durable outbox support simulated dispatch recovery. Stock observations are not inventory reservations or purchases.

### Sponsor contribution and distinctive use

**Zetaris:** the supplier inventory service persists independently in SQLite and exposes HTTP. Courier and route observations come from a separate PostgreSQL simulator. Their tenant/supplier join executes inside Zetaris. Relay uses fixed read templates, bounds the response and checks source-specific facts/timestamps. Independent-source mutation/restoration evidence is recorded in RELAY-02; later full missions read the real federation. Synthetic business data does not become a real supplier service merely because its transport is live.

**Meterless:** the official pinned H-MEM engine stores an explicitly confirmed entrance. Retrieved memory reaches both model roles and the approved simulated task. Event work strengthens correction, forgetting, scope, process-restart and stale-approval safety. Passing product-feature tests and the upstream conformance checks demonstrate the engine's working role. The engine and initial integration are declared prior work. Nightshift additionally routes the actual Nemotron mission and supplies bounded response/receipt metadata; no Runtime policy save alone counts as execution proof.

**NVIDIA:** one recorded RELAY-11 full planning mission through Nightshift used Planner `nvidia/nemotron-3.5-super-vl-120b-a12b` and Critic `nvidia/nemotron-3-ultra-550b-a55b`. It completed in **39,917 ms**, with two inference HTTP POSTs and two Zetaris queries, plus discovery and receipt-log read. Both responses were cache misses and correlated with persisted Runtime receipt IDs. Internal Runtime provider fanout is not measured. Exact configured Lightning pinning remains unverified; receipt correlation is not independent NVIDIA attestation or cryptographic signature verification. No dispatch was approved in that live run.

### Prior work and new event work declaration

We extended an existing ROVER Relay concept and standalone implementation. The entire protected tag `rover-relay-pre-event-2026-10-21` at `1b19c528d639134691289d9c0db38d82e9f277ff` is prior work, including the initial UI, synthetic data, planning/adapters, official third-party H-MEM integration, contracts, tests and simulator. Earlier integration work first observed in the dirty tree retains its recorded Codex attribution and known/unknown timing. A later commit does not reclassify inherited code as new work.

New event slices add confirmed clarification, bounded observation-guided tools, proposal-2.0 semantic review/repair, source-specific evidence, actual Nightshift routing proof, stronger memory scope/restart/correction/forget safeguards, atomic PostgreSQL approval/crash recovery, structured replanning, browser history/provenance/recovery, execution-1.0 public gateway conformance, and measured evaluation. RELAY-12 adds clean-source setup, a current deck and recording guide. RELAY-13 freezes features, audits source/history/evidence and prepares this packet. All local event tickets in this session use **Codex**, with actual commit dates retained. No Cursor work is claimed.

The tag-to-parent committed delta through RELAY-12 is **128 files, 42,354 insertions and 807 deletions**, including large recorded JSON reports. This measures changed source/evidence, not novel lines or author effort. [Public commit and work record](DEMO.md#event-work-and-evidence), [historical prior-work declaration](PRIOR_WORK.md), and [final audit](FINAL_REVIEW.md).

### Current result and limitations

The product demonstrates a checked $32/22-minute sample plan, a $30 infeasible request with a checked $2 minimum increase, and stock-loss replacement at $35/28 minutes requiring fresh approval. The existing measured evaluation separates controlled adapters, seven sample scenarios, actual PostgreSQL checks, real sponsor transport and actual browser observations. The final RELAY-13 offline evaluation passed **114 application tests, 14 actual PostgreSQL checks and 21 applicable public gates**, plus independent clean-source install/build/scenarios. [Final review](FINAL_REVIEW.md) links the exact dated run and its scope. Earlier live sponsor/browser evidence remains separately dated RELAY-11. Three private ROVER gates remain deferred.

Current execution is simulated. The generic public HTTP gateway has controlled conformance tests and constructor injection only; it does not activate private ROVER. Real identity, provider acceptance, jobs, inventory holds, payments and private app regression remain future work. This local reference uses a shared live demo bearer token, not production user/tenant authentication. No automatic model/provider fallback occurs.

### Technical stack

TypeScript, React/Vite, Fastify, Zod, SQLite and optional PostgreSQL. Official H-MEM source is vendored unmodified at `1742dec56a66e58eef9dda2d2b865823758ca8cd`. Zetaris/Nightshift platforms and NVIDIA weights are provisioned separately. [Dependencies and license metadata](DEPENDENCIES.md), [architecture](ARCHITECTURE.md), [CPU setup](JUDGE_QUICKSTART.md), [live provisioning](SPONSOR_SETUP.md).

## Artifact and link checklist

Local links below were checked against the candidate. External event-candidate links must be checked **after separately authorized publication**. A link to the baseline repository is insufficient to demonstrate the new event work.

| Item                  | Local review material                                                                                                                                            | External state / participant action                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source repository     | [README](../README.md), lockfile, public source/config placeholders/tests/vendor attribution                                                                     | [Public repository](https://github.com/multiagent111-collab/rover-relay) is reachable signed out. Its visible default commit is the protected baseline and its public branch list contains only main at review time. Event candidate is not published |
| Event source identity | `codex/relay-hackathon-2026`; RELAY-12 parent `3661743f581ba5c9fc973b576f740ac8f0153d3b`; RELAY-13 commit appears in local Git history                           | Before publication, include the reviewed RELAY-13 commit and explicitly review/include or deliberately exclude the retained inherited delta. Never imply old HEAD includes current working files                                                      |
| Demo video            | [3:30 storyboard and recording procedure](DEMO.md)                                                                                                               | **Missing:** record/review final 1–4 minute video, retain actual capture time/duration/checksum, then supply an accessible participant-controlled video link                                                                                          |
| Slide deck            | [10-slide editable deck](demo/relay-12-deck.pptx), [preview](demo/relay-12-preview.png)                                                                          | Local artifact exists and hash is checked. Its repository URL/notes links to the event branch become usable only after authorized publication. Upload/link the actual reviewed deck separately                                                        |
| Sample proof          | [RELAY-12 clean-source HTTP/setup report](../examples/recorded/relay-12-setup-2026-10-22.json)                                                                   | Public link pending event publication. No private helper or sponsor key needed for CPU sample                                                                                                                                                         |
| Acceptance            | [RELAY-11 summary](../examples/recorded/relay-11-acceptance-2026-10-22.json), [final review](FINAL_REVIEW.md)                                                    | Cite scopes/dates. Do not describe deferred private gates as passing                                                                                                                                                                                  |
| Actual sponsors       | [Live evaluation](../examples/recorded/relay-11-live-evaluation-2026-10-22.json), [source evidence](SOURCE_EVIDENCE.md), [H-MEM feature proof](MEMORY_SAFETY.md) | Keep actual model/receipt identity and the documented report-label erratum. No additional sponsor call was made for final review                                                                                                                      |
| Rights/attribution    | [Third-party notices](../THIRD_PARTY_NOTICES.md), [dependency metadata](DEPENDENCIES.md), bundled H-MEM Apache-2.0 license                                       | Owner has not selected a Relay application license. Review that choice before event-source distribution; no license is assigned here                                                                                                                  |
| Team/track            | Participant-confirmed team name and Wildcard above                                                                                                               | Verify current roster and form selection. Do not infer one-member roster or submission-lock state from old notes                                                                                                                                      |

## Participant submission procedure

1. Review this packet and the local candidate with the confirmed team. Preserve the coding-agent rule clarification and inspect any newer official announcements. Current public text remains inconsistent with the supplied update.
2. Record and review the final video using [DEMO.md](DEMO.md). Check readable modes, actual sponsor identities, simulation labels and prior/new-work disclosure. Never show private credentials, logs, source, trackers or notifications.
3. Review the owner license choice and the retained inherited files listed in [final review](FINAL_REVIEW.md). Decide the exact source snapshot to publish. The final local work does not itself authorize a push, merge, release, upload or deployment.
4. After separate publication authorization, publish only the reviewed public Relay source and required assets. Exclude private configuration/runtime state, the private tracking ledger and private ROVER. Verify signed-out repository, deck/video/evidence links and clone the published revision for a clean setup check. A local audit does not establish future remote link availability.
5. In the participant's signed-in HackOS team workspace, verify exact form fields/limits, selected Wildcard track, current roster and lock implications. Adapt the text above to the actual fields. Provide the actual repository revision, deck and final video links and the prior-work declaration. Do not put placeholders or unavailable local URLs into submitted link fields. No Colab link applies to this implementation.
6. The participant reviews any platform terms and performs the final submit action before the verified deadline. Check the resulting receipt/status in HackOS and retain it. No form was created, terms accepted, organizer contacted or submission made by this task.
