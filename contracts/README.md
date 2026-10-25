# Public integration boundaries

`src/types.ts` defines versioned domain types and the `DispatchPort` interface. `openapi.json` describes the API entry points. The interfaces are new Relay contracts; no private ROVER schema is required.

## MissionRequest

The optional, separately versioned `intake-1.0` draft API persists `needs_input`, reserves the eventual mission ID, and requires exact reviewed constraints plus an explicit confirmation flag. Existing structured requests remain supported. See [intake and coordination](../docs/INTAKE_AND_COORDINATION.md) for revisions, original deadlines, ownership, typed actions and shared budgets. OpenAPI includes `IntakeCreate`, `IntakeUpdate`, `IntakeConfirm` and `CoordinatorAction`. Receipts add optional structured `coordination` traces without changing their existing version.

Exact SKU `HDMI-USB-C`; integer quantity 1–20; destination `auditorium` or `library`; integer budget in USD cents; deadline in whole minutes. The server creates ownership and an absolute deadline. Unknown input fields are rejected.

## DecisionReceipt

Schema version `1.0`; monotonic plan version; SHA-256 digest; creation/expiry; actual mode; source fingerprint; H-MEM revision and recalled records; checked candidates; selected candidate; computed constraint alternatives; source evidence; structured agent steps; change explanation.

A digest binds the proposal to its contents. It is not a digital signature, proof of real-world truth, or substitute for server authorization. The server stores the original and accepts approval only of its current version/digest.

## Source evidence

Source evidence now has additive fields described by `SourceEvidence` in OpenAPI: source kind, normalized facts/content hash and application-projection scope, along with original source/version/times/query references. Existing stored receipt version `1.0` remains readable. New candidates require only their supplier/courier/used-edge observations, and validation enforces every required citation. See [source evidence and federation](../docs/SOURCE_EVIDENCE.md) for freshness, blocked-path coverage, hash stability, query-level provenance limits and reproducible setup.

## DispatchPort

```typescript
requestDispatch(identity, missionId, version, digest, idempotencyKey): Promise<Task>
getTask(identity, taskId): Promise<Task>
cancelTask(identity, taskId): Promise<Task>
```

`RelayService` preserves this public service API and constructs trusted execution intents after current owner/version/digest/expiry/source/memory checks. The narrower injected `ExecutionAdapter` in `src/execution.ts` now owns reservation, delivery, reconciliation and cancellation. Default `SimulatorExecutor` preserves MiniROVER; the separately injected generic `HttpGatewayExecutor` has controlled fixture conformance only. There is no production activation flag or simulator-plus-gateway path. New tasks add optional execution metadata and an atomic persisted intent beside their stable idempotency/outbox records; legacy tasks remain simulated.

The private ROVER adapter should validate the server identity, preserve this approval association, map provider/location IDs, and create or recover one real job through an authoritative private gateway. ROVER's job dispatch must honor the approved terms or return a replacement proposal for approval. A caller-generated job ID can support retries, but does not by itself enforce a chosen provider. Do not store the equipment acquisition total as a delivery fare.

Keep actual user identity, provider acceptance, job state, and payment authority in ROVER. Supply production authentication and reservation protocols when adding real external side effects. The public sample stays runnable without that adapter.

## Execution 1.0 runtime schemas and gateway contract

`ApprovedExecutionIntent.schema.json`, `ExecutionTaskState.schema.json`, `ExecutionEvent.schema.json`, `ExecutionCancel.schema.json` and `ExecutionConflict.schema.json` derive from the runtime schemas/types in `src/execution-contract.ts`. Only exact version `1.0` is accepted. Intent fields include immutable request revision/digest, approved plan version/digest, expiry/deadline, selected supplier/courier, bounded equipment/location references, separate item/delivery/fee amounts and source/memory/evidence bindings. Cross-field arithmetic, timestamp and evidence uniqueness checks are enforced by runtime parsing in addition to the structural JSON Schemas.

`execution.openapi.json` describes three proposed internal gateway operations; these routes are **not served** by the standalone app. The existing public OpenAPI embeds the same schemas without adding privileged routes. Owner identity comes from a verified channel and trusted stored approval, never an arbitrary envelope owner or digest. Cancellation request and confirmation differ; expired committed retries retain their stable mapping. See [execution trust, retry/version policy and test steps](../docs/EXECUTION_CONTRACT.md) for the full contract, typed conflict guarantees and deferred production gates.
