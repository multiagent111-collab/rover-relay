# PostgreSQL approval and recovery checks

RELAY-07 retains Relay's small, row-locked JSON aggregate. A transaction takes `SELECT ... FOR UPDATE` on its single state row before checking the current plan and atomically updating the mission, simulated courier slot, task, owner-scoped idempotency entry, outbox message and dispatch event. This serializes writers across PostgreSQL connections. There is no production job-schema migration.

## Run the isolated verification

From the Relay directory in PowerShell, with Docker Desktop's Linux engine available and the `postgres:16-alpine` image already cached:

```powershell
npm.cmd run test:postgres
npm.cmd test
npm.cmd run build
```

`test:postgres` creates a uniquely named, labelled container with temporary PostgreSQL storage in tmpfs, a random password and a dynamically assigned loopback port. It never accepts the application's database URL, reads `.env`, pulls an image, or mounts a live volume. Every case has its own schema and H-MEM directory. The ordinary test command runs the application regressions; the explicit PostgreSQL command runs the additional integration checks and fails if Docker or PostgreSQL is unavailable. RELAY-08 expands the original 10 database checks to 12; see the [current lifecycle tests](LIFECYCLE.md). There is no SQLite fallback or skipped integration success.

Cleanup verifies the exact container ID and run label before removing that container and its volumes. It resolves and checks the dedicated temporary directory before recursive removal. A crash worker's stale H-MEM writer lock is removed only after the child exit event, a matching lock PID, an OS check that the PID is gone, and an unchanged lock-file check. This is a test harness operation, not automatic application recovery. Abruptly terminating the harness itself may retain test resources; inspect their printed unique container name and ownership label before manual cleanup. Never remove the live `relay-courier-source` container or its volume.

## What is exercised

- Eight simultaneous approvals use real PostgreSQL connections. An independent transaction holds the row lock and `pg_stat_activity` confirms at least two approval transactions waiting on it before release. All eight return the same task, with one reservation, idempotency entry, dispatch event, outbox message and simulated offer event.
- A deterministic delayed source read reproduces an approval that starts before another commits but sees its reservation afterward. Exact owner/key/signature replay now returns the committed task when the attempted replan refuses its active task. A different key or payload cannot use that recovery path.
- Competing keys on one plan and two missions selecting the same courier produce one success and one conflict, with one committed reservation.
- A child process exits without application close hooks after approval COMMIT and before outbox delivery or response. A second child reopens the database, commits startup outbox delivery and exits before response. Reopen, exact-key retry, concurrent drains and another restart preserve the original task, approval digest/version, confirmed entrance, deadline and event/message IDs; no extra offer event appears.
- Changed payload with the original key conflicts; another owner cannot replay the task. The same literal key can independently serve another owner's mission.
- Plan expiry during a row-lock wait blocks approval. Repeated replanning preserves the original absolute deadline. Changed memory, changed source revision and caller cancellation during lock waits also block commit.
- A real five-second row-lock timeout returns a safe 503 and rolls back. Releasing the blocker and retrying the original approval succeeds once.
- A controlled deferred PostgreSQL trigger raises SQLSTATE `40001` during COMMIT. The caller receives `storage_outcome_unknown`; the database has rolled back. Removing that test trigger and retrying the exact original key creates one task. This is a server-side injected commit failure, not a claim of a naturally occurring serialization anomaly.
- A test trigger terminates its own real PostgreSQL backend during UPDATE. The callback runs once, the aggregate change rolls back, the failed connection is discarded and a later transaction succeeds.

## Failure and retry policy

PostgreSQL connections and pool acquisition have a five-second timeout, row-lock waits five seconds, server statements ten seconds, client query reads fifteen seconds and idle transactions ten seconds. These are individual operation limits, not a single end-to-end request deadline. A network failure can also require a bounded rollback attempt.

Storage failures return sanitized 503 errors. Checked-out and idle connection errors are handled without unhandled socket exceptions. Failed rollback does not overwrite the original failure and damaged connections are discarded. A lost COMMIT acknowledgement is treated conservatively as an unknown outcome.

There is deliberately no automatic transaction-callback retry: callbacks allocate task/event IDs and may read the H-MEM ledger. Retry the **same mission ID, plan version, digest and idempotency key under the same owner**. A committed request returns its stored task, even if the receipt subsequently expires or its original source snapshot has changed. An uncommitted retry still has to pass current owner, plan, expiry, source, memory and courier checks. A changed request needs fresh approval; do not silently generate a new key to bypass a conflict.

This verifies simulated operations with actual PostgreSQL and the unchanged official H-MEM engine. Sample model/data adapters make no hosted calls. Outbox deduplication covers the local atomic simulator event; it is not an exactly-once guarantee for an external courier, real booking, payment or provider notification. It does not test database-host power loss, failover or large-scale throughput. The aggregate intentionally serializes all writers.

Recorded run versions, assertion results and actual task/event IDs: [RELAY-07 evidence](../examples/recorded/relay-07-postgres-2026-10-22.json). Pause for user testing before RELAY-08.
