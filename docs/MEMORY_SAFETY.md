# Confirmed memory and recovery (RELAY-06)

Relay uses the unchanged official Meterless H-MEM reference revision `1742dec56a66e58eef9dda2d2b865823758ca8cd`. The official engine owns records, hybrid retrieval, reinjection formatting and the append-only trust ledger. RELAY-06 adds an application boundary around that engine; it does not replace its source or claim that inherited engine functionality was newly authored here.

## Preference influence and approval

Entrance preferences require an explicit confirmation through `PUT /v1/preferences/entrance`. The authenticated tenant/user and validated venue select an opaque owner-hash directory. Request bodies cannot choose another owner. Only user-confirmed entrance preference records enter model context; factual/operational records are excluded. The application never mines stock, prices, courier availability or hard request limits into durable preferences. Source and recalled text remain untrusted model data.

Both separately invoked Planner and Critic receive the recalled records and effective entrance. Deterministic validation binds that entrance into proposal-2.0 terms. Approval rechecks the current memory revision before committing the task, and the approved task copies the effective entrance. A correction removes the superseded entrance from active H-MEM retrieval; forgetting deletes only active confirmed entrance records, preserving unrelated notes and other user/venue scopes. The next planning run sees only the correction, or no entrance after forgetting.

Revisions include the store identity, owner/venue, preference generation, engine sequence and active record IDs/content. Reads update H-MEM access/audit data without changing the preference revision. Set/forget cycles cannot revive an old approval merely by returning to the same text or an empty preference. Upgrading an existing store changes the revision scheme once, so a pending older receipt requires fresh planning and approval. Existing task terms and idempotent recovery of an already committed task remain governed by their original approved receipt.

## Persistence guard and failure policy

The reference engine reads JSON directly and persists state in place. Before invoking it, Relay validates bounded `state.json` and `ledger.jsonl`, record shapes, unique/monotonic IDs, active create/delete history, read counts and active preference provenance. The namespace must agree with its registered scope and last successful checkpoint. After a successful operation, Relay validates the resulting pair and atomically replaces its checkpoint. Only normal validated legacy pairs are adopted; a legacy empty state without a ledger is permitted only at sequence zero. Relay's adapter currently supports its own create/read/delete workflow; importing files written by other H-MEM workflows requires a reviewed migration.

Private files under the existing H-MEM directory:

- `relay-scopes.json`: store identity and registered opaque owner/venue namespaces. A registered namespace disappearing is an error.
- Each namespace's `relay-memory.json`: pinned engine revision, preference generation and SHA-256 state/ledger digests.
- Temporary checkpoint files: an unfinished write remains recovery evidence and blocks automatic reuse.

Malformed JSON, inconsistent shapes/history, missing registered files, non-regular files, symlinks, unreadable files, digest mismatches or interrupted writes return HTTP 503 `memory_unavailable`. New planning and approval are blocked for that venue. There is no automatic empty-memory substitution, cached-preference fallback, deletion, truncation or backup rollback. A failed application adapter remains blocked until the owning application is restarted after recovery. If a write fails partway through a vendor operation, the partial state/ledger and prior checkpoint remain available for inspection; they are not declared a completed preference update.

Bounds are 2 MiB for state, 8 MiB for ledger, 1,000 active records and 1,000 registered scopes. Crossing a bound requires private maintenance rather than silent pruning. The existing application writer lock still requires one process per data directory; direct engine tools must not write that directory while Relay owns it. Local digests and the scope registry detect ordinary missing/changed files; they are not signatures, tamper-proof storage, a power-loss transaction guarantee or a defense against replacement/removal of the entire private data tree.

On an error, stop the owning process and preserve the whole affected private memory directory, its scope index, checkpoints and any temporary files before investigating permissions or storage damage. Recover only from a consistent trusted private backup after reviewing its age and active preferences. Confirm/correct/forget the effective entrance with its owner before allowing new approval, so restored historical preferences are not silently treated as current. Do not delete a bad ledger or checkpoint to force the app to start. A valid repair or backup is a deliberate operator recovery step; Relay supplies no destructive reset command.

## Forgetting and privacy

Forgetting removes active preference influence. It does **not** erase previous receipts, task instructions, backups or the engine's append-only ledger, which may retain the old text. Existing receipts and tasks remain owner-scoped. New `memory_retrieved` events contain record IDs, revision and engine identity rather than preference contents. Diagnostic errors omit memory text and filesystem contents. Private audit inspection can include deleted record histories; it is not a public endpoint. Public RELAY-06 artifacts contain only synthetic test entrances, IDs, status codes and action names.

The browser clears its displayed memory after a failed read, shows the controlled failure, and disables new approval when that failure is known. It also explains active forgetting. Backend validation remains authoritative even before the browser has learned about storage damage.

## Recorded verification

All **87 behavior/adapter tests**, production TypeScript/Vite build, all **15 official source hashes** and all **13 unmodified H-MEM conformance checks** passed. The final six memory tests passed again while capturing [the process-restart feature report](../examples/recorded/relay-06-memory-2026-10-22.json) and [controlled file-failure cases](../examples/recorded/relay-06-memory-failures-2026-10-22.json).

Three actual serial OS processes used one isolated directory, closing each writer before starting the next. They confirmed an original entrance, recalled it after restart into both model roles, corrected it, rejected old approval, and created a simulated task carrying the correction. After forgetting, old approval was rejected again; both roles received no entrance and a fresh simulated task carried `null`. Other user/venue preferences stayed intact. Cross-user mission/task reads and approval returned 404. The final process verified that active influence stayed absent while private deletion audit history remained. Both test tasks were cancelled and the temporary fixture was removed. Test receipt TTL was extended only inside that isolated fixture to allow serial process setup; the running application's normal short approval expiry is unchanged.

Controlled tests also cover eleven corrupt/missing/interrupted-file cases, injected read denial and write failure, legacy inconsistency and namespace loss. The eleven API cases returned 503, invoked no model, created no task and preserved the files after rejection. No live sponsor inference or production preference mutation is claimed in this ticket. The sample at port 4183 was gracefully refreshed with persisted data retained and its memory panel visually checked. Existing live services, provider settings, vendor source and Build were preserved.

## User test checkpoint

On http://127.0.0.1:4183/ enter a test entrance and Save preference, then find a plan and inspect the entrance in its receipt. Change and save the entrance; approving the previous plan must request a refreshed plan and renewed approval. Forget the active preference, then find a fresh plan and check that no entrance is applied. Existing receipt/audit text may still show earlier values, as explained above. For the repeatable isolated process/corruption checks, run `node --import tsx --test tests/memory.test.ts` from Relay. Do not corrupt the running sample's files to test recovery.

Pause for testing before RELAY-07.
