# Clarify, confirm and gather evidence

The optional **Describe what happened** panel saves a request draft before planning. The original structured form remains available. Try “two adapters for my event soon”: Relay asks for compatibility, venue, total budget and deadline, with quantity 2 already extracted. Fill the review fields, optionally save without planning, reload/resume, then explicitly confirm the displayed constraints. A checked plan still needs the separate dispatch approval.

Text extraction is deterministic and deliberately limited to bounded phrases: numbers/one–ten before adapters, explicit USB-C to HDMI compatibility, auditorium/library, USD amounts, and minutes. “Soon,” unsupported equipment, missing fields and recognized contradictions require clarification. It is not a general language model, and memory never supplies hard requirements. Every extracted field is reviewed before confirmation. Existing confirmed H-MEM entrance preferences are recalled only in the normal planning path.

## Draft API and persistence

The additive `intake-1.0` contract reserves a mission ID immediately and persists `needs_input` drafts in the existing store's optional `intakes` map. No source or inference call happens during draft creation/editing. Existing `MissionRequest`, stored receipt `1.0` and structured mission API remain compatible.

| Operation | Behavior |
|---|---|
| `POST /v1/intakes` with `{ "text": "two adapters for my event soon" }` | Returns ID/missionId, extracted fields, questions, revision 1 and `needs_input`; even complete drafts require confirmation |
| `GET /v1/intakes/:id` | Resume the owner's persisted draft |
| `PATCH /v1/intakes/:id` with `{ "revision": 1, "fields": {...} }` and/or `text` | Validate and save explicit corrections; increment revision; stale edits fail with 409 |
| `POST /v1/intakes/:id/confirm` with `{ "revision": 2, "confirmed": true, "request": {...} }` | Requires complete, conflict-free fields matching the reviewed values exactly; plans the same reserved mission ID |

Confirmation atomically creates the ordinary mission and marks its draft confirmed. Retrying confirmation with the same request returns the existing mission without another planning run; different terms conflict. Pending drafts are read through the intake endpoint; the ordinary mission endpoint applies after confirmation. Owner checks and the existing bearer/demo identity rules apply to every draft route. Bootstrap includes only that owner's pending drafts. The UI offers the new panel only when bootstrap advertises intake support, so the preserved older live backend continues to serve its original structured workflow.

Drafts retain their original creation time. A supplied minute deadline is anchored to that time, including when the field is first clarified later. Editing or waiting cannot move an established cutoff later. An explicit shorter deadline is allowed; a later event needs a new request. Waiting for the user does not consume active planning time, but does consume the operational delivery window. An elapsed draft cannot be confirmed. No receipt, task, reservation or dispatch exists before confirmation.

## Observation-guided read decisions

The typed action union is `ask_user`, `read_equipment_options`, `read_courier_availability`, `read_route_edges`, `propose`, or `finish_infeasible`. Argument schemas reject unknown fields, SQL/URL operations, dispatch actions and invalid source identifiers. The coordinator validates each action against the confirmed request and observations before executing an allowlisted operation. Source/memory descriptions are data, not instructions.

Default selection is a deterministic observation policy, not an LLM-selected-tool claim. It reads equipment first. No sufficient stock leads directly to `finish_infeasible`; sufficient stock leads to courier availability. No capable available courier skips route reading; an available courier leads to route observations. A valid path leads to `propose`, otherwise `finish_infeasible`. Planner and Critic then use the existing domain/evidence checks, receipt and approval logic. The terminal decision never dispatches anything. This is model-assisted planning with an observation-guided rule policy, not a claim of fully autonomous model coordination.

The backend intentionally reuses the complete existing snapshot adapter. One gather lazily loads a full snapshot and supplies logical equipment/courier/route projections from it. Skipping a logical route action does **not** mean the backend avoided fetching route SQL. A Critic refresh performs another gather and consumes the same remaining budget. Receipts record both logical `toolCalls` and attempted `backendSnapshotCalls`; Zetaris may execute multiple fixed queries within one snapshot. No replacement join, arbitrary URL or model-authored SQL is introduced.

## Shared budgets and cancellation

Each active planning attempt shares at most six inference slots, six logical read calls and one 180-second deadline across gathering, selections, Planner/Critic retries and evidence refreshes. RELAY-04 narrows Planner/Critic to an initial proposal plus one targeted repair, within the original three-round ceiling; refreshes occur only while a repair remains. See [checked proposal semantics](PLANNER_CRITIC_REVIEW.md). The default phrase extractor and selector make zero inference calls. An injected selection adapter that declares inference use is charged against the same six-slot total; controlled tests demonstrate four selection calls plus two Planner/Critic calls consuming all six slots.

Budget counters count attempted generator/selection invocations, including deterministic substitutes in offline mode; they do not attest hosted model calls. Real provider/model identity remains in the existing agent steps. `extractionCalls=0` describes the current deterministic extractor. Internal tests may lower limits but cannot configure a budget above the declared maxima. Invalid actions, exhausted budgets or cancelled/late dependency results produce controlled failures without a new dispatch task. Read/selection/model awaits are raced against the shared signal, including adapters that ignore cancellation. HTTP disconnects propagate that signal to creation, confirmation and replanning, including approval-triggered and simulator-decline-triggered replans. Already committed task effects remain governed by normal idempotent recovery, not an automatic undo promise.

Receipts add `coordination` with validated structured actions, result counts and budget usage. Events include `coordinator_action` and `planning_budget`, including failure attempts. Draft events record `ask_user` fields and confirmation requirements. They do not store private model reasoning or raw upstream errors. Draft text itself stays in the owner-scoped local store, as user input; it is not passed to Planner/Critic as instructions.

## Verify this slice

Run `npm.cmd test` and `npm.cmd run build`. The new isolated tests cover persistence/restart, owner separation, conflicts, exact confirmation and replay, original deadline preservation, invalid tool arguments, different observation paths, shared refresh/inference budgets, ignored cancellation and late model output. Existing H-MEM, source evidence, dispatch and recovery regressions remain in the suite.

The observed browser demo on port 4183 used synthetic fixtures, deterministic extraction/selection and deterministic Planner/Critic substitutes. It saved, reloaded and resumed a draft, confirmed the same mission ID/deadline, inspected its checked receipt/read decisions, and created no dispatch task. The active plan used three logical reads, one backend snapshot and two generator slots; no hosted model, Zetaris or Nightshift call occurred in this ticket. Controlled model-selection tests are labeled as injections. See `examples/recorded/relay-03-intake-2026-10-22.json` for actual IDs/times and limits.

The isolated sample was gracefully refreshed without deleting its persisted state. Existing live services on 4173/4174, private configuration, source definitions and Build were preserved. Full Nightshift routing remains RELAY-05. Stop after RELAY-03 for user testing before RELAY-04.
