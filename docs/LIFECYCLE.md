# Disruptions, alternatives and simulated tasks

RELAY-08 adds structured change receipts and strengthens the existing simulator lifecycle. Hosted data/inference modes remain separate from execution: every task here still uses the local simulator. No provider is contacted by a task response or cancellation control.

## Changed plans require fresh approval

Stock depletion, a named edge closure, changed courier/supplier, price, travel time or confirmed entrance invalidate the old approval. A replacement keeps the mission ID, request constraints and original absolute deadline, increments the plan version and receives a new digest. It creates no replacement task until the coordinator approves that exact version/digest with a new approval key. Retrying an already committed approval returns its historical task, including a declined or cancelled task; it never approves the replacement.

New receipts have optional `changeDetails` using `change-1.0`, included in the receipt digest. It records typed reasons, previous version/digest/terms, current version/terms, changed source records with before/after facts, memory revisions, the original deadline, simulated operations and required confirmation. Historical receipts without this additive metadata remain readable. `plan_created` exports the same structured change. The existing readable change notice remains available; richer change comparison UI belongs to RELAY-09.

Sample `/demo/disruptions` controls accept stock updates and a named edge's closed flag. Real changes increment source versions and append `source_changed` with before/after facts. Repeating an already applied value changes neither versions nor events. These controls remain sample-only. Live supplier data still comes from the independent supplier source through Zetaris; this ticket does not mutate that running source or change its administration API.

## Decline, cancellation and event ordering

- A valid decline releases the local courier slot once. Task history excludes that courier from this mission's later candidate set, including alternatives; another mission may still propose it if its fresh source observation permits. The declined task and approved terms remain in history. One bounded planning/repair run proposes an alternative requiring fresh approval. Duplicate decline responses return the existing task without another planning run, task, release or event.
- If planning after a committed decline fails, the task stays declined, its slot stays released, and the mission reports dependency failure. Explicitly replan that same mission after fixing the dependency. Duplicate decline responses do not restart inference. Replanning retains the original deadline and decline cause.
- Cancellation is allowed from queued, dispatch requested, accepted and in progress. It atomically records `cancellation_requested`, confirms `simulated_cancelled`, updates the task and releases its local slot once. `task.cancellation` names the `simulator` backend and records request/confirmation times. A queued outbox entry drained after cancellation is marked delivered without sending a simulated offer. A completed task cannot be cancelled.
- Current tasks follow queued → dispatch requested → accepted → in progress → completed, with decline allowed only from dispatch requested. Invalid, stale and reordered transitions return 409. Obsolete tasks cannot change a newer mission/task or send an obsolete queued offer. Duplicate responses at the existing status return the stored task without side effects; repeating a historical cancellation cannot free a newer task's slot.
- New tasks include a monotonic `revision`, starting at 1 and advancing on offer delivery and each state change. `/demo/tasks/{id}/response` and `/v1/tasks/{id}/cancel` accept optional `expectedRevision`; a mismatched revision blocks a new transition. Same-status duplicates remain idempotent. Stored legacy tasks without a revision start from 0 when next changed. Existing clients may omit this additive field and still use the guarded transition graph.
- A planning run also checks that the mission's task identity has not changed since it started. Late planning success or failure cannot overwrite a task approved and cancelled while that run was waiting for model output.

The simulator confirms cancellation locally in the same transaction as its request. There is no external execution backend in this feature. A future external adapter must retain separate requested and confirmed cancellation states, wait for authoritative confirmation before releasing a real reservation, and deduplicate its own provider events. These local events do not attest real cancellation, acceptance, purchases, booking or delivery.

## Alternatives keep constraints separate

The minimum extra budget uses only structurally valid, evidenced, on-time candidates. The minimum extra time uses only structurally valid, evidenced, within-budget candidates. Stock, compatibility, courier availability/capacity, prior decline and route failures exclude options from both calculations. Elapsed time reduces remaining time; replanning never moves the original deadline.

`alternatives.status` and `explanation` distinguish an existing valid option, budget-only, time-only, either single change, both changes required, or no available operational option. Infeasible receipt summaries also show the explanation. `null` means that single relaxation has no checked solution. Relay never reduces quantity, changes compatibility or silently grants extra time/budget.

In the isolated fixture, two adapters with a $35 budget and 20 minutes produce independent alternatives of **+$5** or **+2 minutes**. At $30 and 10 minutes, neither one-variable change works, so both numbers are null and the receipt explicitly says both changes are required. Missing source evidence cannot produce a cheap or fast alternative.

## Verify and test

From the Relay folder:

```powershell
node --import tsx --test tests/lifecycle.test.ts
npm.cmd test
npm.cmd run test:postgres
npm.cmd run build
```

The ten lifecycle tests create isolated SQLite/H-MEM directories and remove them afterward; outbound fetch is blocked. They cover changed stock/edge/entrance, price/ETA/courier changes, duplicate decline, cancellation at all four active stages, old responses after replacement, invalid/reordered transitions, revisions/legacy state, ownership, failed planning recovery, late planning results after an intervening terminal task, source no-ops and independent alternatives. Source/entrance mutations are limited to disposable fixtures; no live source or saved user preference is changed.

The explicit PostgreSQL suite now has 12 checks, including four concurrent declines behind an observed row lock, acceptance/cancellation races with the same revision, and cancelled queued outbox draining across restart, alongside RELAY-07's real commit/crash/timeout/backend-failure checks. Its [guarded container cleanup](POSTGRES_SAFETY.md) removes only test-owned resources. Final runtime versions and actual receipt/task/event IDs are in [RELAY-08 evidence](../examples/recorded/relay-08-lifecycle-2026-10-22.json).

For interactive testing, open the sample on port 4183, create a mission, approve it and simulate a decline. The replacement needs a separate approval; cancellation releases only a local simulated slot. Use the isolated tests above for stock/route changes if you want to preserve the sample's saved source facts and preferences. Pause for user testing before RELAY-09.
