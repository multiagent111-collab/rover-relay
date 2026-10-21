# Public integration boundaries

`src/types.ts` defines versioned domain types and the `DispatchPort` interface. `openapi.json` describes the API entry points. The interfaces are new Relay contracts; no private ROVER schema is required.

## MissionRequest

Exact SKU `HDMI-USB-C`; integer quantity 1–20; destination `auditorium` or `library`; integer budget in USD cents; deadline in whole minutes. The server creates ownership and an absolute deadline. Unknown input fields are rejected.

## DecisionReceipt

Schema version `1.0`; monotonic plan version; SHA-256 digest; creation/expiry; actual mode; source fingerprint; H-MEM revision and recalled records; checked candidates; selected candidate; computed constraint alternatives; source evidence; structured agent steps; change explanation.

A digest binds the proposal to its contents. It is not a digital signature, proof of real-world truth, or substitute for server authorization. The server stores the original and accepts approval only of its current version/digest.

## DispatchPort

```typescript
requestDispatch(identity, missionId, version, digest, idempotencyKey): Promise<Task>
getTask(identity, taskId): Promise<Task>
cancelTask(identity, taskId): Promise<Task>
```

This iteration implements the port in `RelayService` using the MiniROVER simulator. Only the deterministic executor can create tasks. The task records the approved version/digest, selected courier and supplier, entrance, stable task ID, and idempotency key. The outbox's stable message ID deduplicates simulated delivery.

The private ROVER adapter should validate the server identity, preserve this approval association, map provider/location IDs, and create or recover one real job through an authoritative private gateway. ROVER's job dispatch must honor the approved terms or return a replacement proposal for approval. A caller-generated job ID can support retries, but does not by itself enforce a chosen provider. Do not store the equipment acquisition total as a delivery fare.

Keep actual user identity, provider acceptance, job state, and payment authority in ROVER. Supply production authentication and reservation protocols when adding real external side effects. The public sample stays runnable without that adapter.
