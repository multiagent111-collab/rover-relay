# Execution contract and adapter boundary (RELAY-10)

The standalone app continues to run MiniROVER. `RelayService` owns checked planning and explicit approval. Its injected `ExecutionAdapter` owns reservation, offer delivery, task reconciliation and cancellation. `SimulatorExecutor` contains the existing simulator; `HttpGatewayExecutor` is exercised only against a controlled public loopback fixture. No deployed gateway, real provider acceptance, notification, purchase or private ROVER integration is claimed.

## Compatibility and one executor

Existing mission approval, task, cancellation and demo response URLs/bodies remain compatible. The optional eighth `RelayService` constructor argument injects exactly one executor; without it, the service creates the simulator. There is no environment flag or public API that enables the HTTP executor. `createApp` still selects the simulator in both offline sample and live sponsor modes; live planning does not mean real delivery.

New tasks have additive `execution` metadata and a persisted `executionIntents[taskId]` entry. The mission, intent, task, scoped approval idempotency mapping and outbox are committed in the same Relay transaction. The selected adapter stages capacity there: the simulator reserves its local/shadow fixture slot; the HTTP adapter guards pending local mission/provider slots without mutating simulator fixtures. The remote gateway must independently reserve authoritative capacity in its own atomic job/outbox transaction.

Only the selected executor drains that task's outbox or changes its lifecycle. Wrong-backend recovery/transition fails closed. There is no simulator-plus-remote dispatch, no fallback and no auction/substitution. Legacy tasks without metadata remain simulator tasks and retain their earlier lifecycle behavior. A backend change requires an explicit reviewed migration/reconciliation; changing the constructor is not a migration.

## Execution 1.0

Runtime validators/types live in `src/execution-contract.ts`. `npm run contracts` regenerates five JSON Schemas, embeds them in the existing public OpenAPI and writes the separate `contracts/execution.openapi.json`. The three proposed `/internal/relay/v1/...` gateway operations are a contract; the standalone Relay server does **not** expose them.

| Envelope                | Required binding                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ApprovedExecutionIntent | Stable intent/task/mission UUIDs; immutable request revision 1 and normalized request digest; stored approved plan version/digest; approval/expiry/deadline; selected supplier/courier; bounded equipment; location references/confirmed entrance; separate item, delivery and explicit fee cents; source fingerprint, H-MEM revision and evidence IDs |
| ExecutionTaskState      | Same request/approval/provider bindings; stable gateway job reference (null in simulator projection); monotonic revision/server time; authoritative status and optional cancellation request/confirmation                                                                                                                                              |
| ExecutionEvent          | Event UUID, supported state transition type and versioned task snapshot; Relay persists only new authoritative revisions                                                                                                                                                                                                                               |
| ExecutionCancel         | Intent ID, stable intent-derived cancellation key and original expected task revision                                                                                                                                                                                                                                                                  |
| ExecutionConflict       | Versioned typed error/message; unknown outcomes remain retryable with the original intent                                                                                                                                                                                                                                                              |

All objects reject unknown fields and versions. Only exact `1.0` is supported, including rejection of `1.1`; a compatible future release requires reviewed runtime/types/schema/test changes. The current request is immutable, so its revision is explicitly 1. Editable requests require a new revision policy before introduction. SKU remains `HDMI-USB-C`, quantity 1–20, integer nonnegative USD cents, bounded evidence and identifier fields. `parseExecutionIntent` additionally enforces total arithmetic, unique evidence IDs, and approval < expiry <= absolute deadline; JSON Schema alone cannot express those comparisons. New-intent validation checks approval time and expiry/deadline at acceptance. Task parsing also checks cancellation timestamps/state. The simulator uses the same task projection/validator for new records.

For the standard two-adapter sample, $24 equipment plus $8 delivery gives $32 total. Delivery fare is **800 cents**, never 3200. Location IDs are references for an explicit allowlisted gateway mapping; they are not coordinates. Observed supplier stock is not an inventory reservation or purchase.

## Approval and identity trust

The browser submits only the existing current version/digest/key approval body. Relay retrieves the owner-scoped stored mission, checks current approval state, expiry, fresh source fingerprint, deterministic feasibility and confirmed memory revision, and constructs the intent itself. Request digest uses the runtime request schema's field order, including after JSONB storage. A caller-computed digest, invented owner property or edited candidate/price does not create trusted approval.

Gateway identity must come from a separately verified channel. The HTTP adapter requires an injected authorization callback binding verified tenant/subject, HTTP method/path and SHA-256 of the exact UTF-8 body (empty body for GET). The controlled fixture signs short-lived assertions with an ephemeral random HMAC key, verifies expiry/signature/body binding, rejects replay identifiers and compares the intent with a separately stored trusted approval/owner. It never accepts an owner from the intent body or unsigned identity headers. The app's demo identity/shared live demo token is **not** production ROVER authorization.

The fixture's registry is populated by Relay's trusted committed intent/task state. It also checks its explicit synthetic provider/location/quote mapping. Production must supply verified user/tenant membership, a reviewed assertion/JWT protocol and key handling, least privilege, private provider/location mapping, fresh quotes/capacity, durable unique job/intent associations and authoritative dispatch. Those private implementation and deployment gates remain deferred.

## Retry, conflicts and cancellation

1. Relay scopes approval keys by tenant/user and binds mission/version/digest. Exact retries return the original task/intent. Changed payload under the same key conflicts. New approval cannot overlap an active mission or selected provider slot.
2. Gateway verifies identity and exact trusted terms, then looks up the scoped committed intent **before** checking new-intent expiry. Identical retries after expiry return the same job. New expired intents reject. No automatic HTTP retry allocates new identifiers.
3. Network loss, timeout, malformed or incompatible response and unknown outcomes retain the queued task and original pending outbox. Retry the exact original approval key. Reconstructing the adapter or reading persisted JSONB does not regenerate task, intent, job or message IDs.
4. Typed new-intent conflicts `provider_unavailable`, `quote_changed`, `mapping_missing`, `unapproved_plan`, `intent_expired` and `plan_changed` guarantee **no job was committed for that intent**. The HTTP adapter records a terminal local declined/rejected attempt with `execution.rejectionCode`, marks its message processed and requires an explicit new plan/approval. This is not a provider decline and does not permanently exclude the provider from a newly reviewed quote. Other/uncertain conflicts keep the original pending execution. A gateway that cannot prove non-commit must return `dependency_unavailable`, never a definitive conflict.
5. Provider decline or changed terms never silently chooses another provider. Gateway authoritative decline can be reconciled, followed by an explicit replan and separate approval. The public simulator retains its automatic post-decline proposal generation, which creates no replacement task until approval.
6. Gateway requests have a bounded 10–30000 ms timeout (default 5 seconds), bounded 32 KiB responses, no redirects and sanitized errors. Responses must match intent, request, plan, provider, backend and stable job ID. Older revisions are ignored; conflicting same-revision snapshots, backwards active states and changed terminal state fail closed.
7. Cancellation persists a stable request/key before sending. `cancel_requested` keeps the prior active `Task.status` plus `cancellation.confirmedAt: null`; it neither releases capacity nor claims cancellation. Only an authoritative confirmed snapshot sets `cancelled`. Retry/reconciliation preserves the original cancellation key/revision after response loss. Simulator cancellation remains an immediate local confirmation.

The HTTP adapter does not implement production JWT verification, background event subscriptions, gateway deployment, financial settlement or real inventory holds. The controlled fixture serializes its synthetic transaction in one process and stores jobs in memory. It is a conformance target, not a production database implementation. Relay's PostgreSQL recovery is tested separately using an actual isolated database and a new connection pool.

## Test this package

In the public Relay repository:

```powershell
node --import tsx --test tests/execution.test.ts
npm.cmd test
npm.cmd run test:postgres
npm.cmd run build
```

The nine execution checks use disposable SQLite/H-MEM directories and an ephemeral loopback gateway. They cover both executors, exact scoped retries after expiry, wrong owners, fabricated approval terms/versions, unsigned and replayed channel assertions, body binding, provider contention, wrong-backend rejection, connection loss and a real 500 ms timeout after commit, stable one-job recovery, pending/confirmed cancellation, definitive quote/provider conflicts and invalid responses. They make no hosted sponsor call. The PostgreSQL suite adds an actual JSONB/new-pool recovery case to the existing row-lock/crash/lifecycle checks. The managed sample is never used as test storage.

For manual testing, open the sample on port 4183, create a two-adapter auditorium request at $35/30 minutes, review and approve once, then exercise accept/progress/cancel or decline/reapprove. Operations must remain labeled simulated. Existing owner/version/source/memory/expiry controls still apply. The HTTP fixture requires no deployed gateway or credentials and is tested through the command above; there is no production activation step.

See [sanitized controlled run](../examples/recorded/relay-10-execution-2026-10-22.json). This run demonstrates one synthetic job after a real timeout, same intent/task/job on retry after a controlled 120-second clock advance beyond expiry, zero simulator offers/fixture mutations, and cancellation request followed by separate fixture confirmation. It is not a real ROVER booking.
