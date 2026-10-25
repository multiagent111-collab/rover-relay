# Browser workflow and provenance

RELAY-09 keeps the existing workspace and adds accurate startup, history, recovery and evidence views. Open the managed sample at `http://127.0.0.1:4183/` after starting Relay with the documented local command.

## Connection and execution labels

Before authenticated bootstrap succeeds, the page says **Connection unresolved** and leaves data/inference/execution unresolved. A failed connection does not become an asserted offline sample. Connection settings offer reload/retry and a separate local Relay access-token field. Sponsor credentials belong on the server and are never requested by the browser. The existing local token is held in session storage for this tab when available; blocked storage falls back to memory. Clearing it clears protected mission/task/event views.

Once connected, the source strip distinguishes synthetic fixtures or Zetaris, the server's configured inference provider, and the local simulator. Receipt inference providers and reported model/request/Runtime IDs are displayed separately. NVIDIA direct is never labelled Nightshift. Configuration is not proof of an inference call. Already running compatible servers can supply passive readiness through `/v1/readiness`; no sponsor call is made to obtain it.

Live maps hide sample route facts. They use current live receipt route observations, require live observation labels and timestamps within 60 seconds with at most 5 seconds of future skew, and suppress malformed or unmapped routes. Only schematic node positions come from the illustrative campus layout. Sample stock, courier availability and route edges are not substituted into a live map. Missing/stale data explains how to refresh. Unknown node positions leave the source record/route IDs available in evidence instead of inventing coordinates.

## Requests, retries and history

The request draft asks for missing constraints before confirmation. Confirmation retrieves the saved draft revision first. If an earlier confirmation committed while the browser was interrupted, retry opens that saved mission. Changed revisions return to field review. The operational deadline stays anchored to the original draft.

During a request, mutation buttons are disabled and **Stop waiting** aborts the client wait. It does not promise that a server transaction was rolled back. Recovery reloads current state, retains failed/saved missions, and keeps the original approval key/version/digest on approval retry. A failed mission has an explicit planning retry using its original deadline. Browser requests have bounded timeouts and do not reflect raw network diagnostics. Authentication changes discard late responses from the prior credential.

Missions sort by descending `createdAt`, with ascending ID as a stable tie-breaker, in both the server and the UI. PostgreSQL object-key order is irrelevant. Search by ID, venue, status or date; filter statuses including failures; use **Show more missions** after the first eight. History remains available on mobile. All mission events, including failures, can be expanded or exported; no history is deleted to clean up a demo.

## Review before approval

Costs, equipment quantity/unit price, delivery estimate, observed stock, ETA and checks come from structured checked candidates. New changed-plan comparisons show previous/current supplier, courier, cost, ETA, route and entrance, plus source changes and memory revisions. The page distinguishes a proposal needing fresh approval from terms already approved for its stored simulated task. A historical task retains its own provider identity and approved version instead of borrowing the replacement proposal's courier.

Exact plan/version/digest, original deadline, expiry, source fingerprint and memory record/revision IDs are inspectable. Model and request IDs, projected Runtime metadata, source/query observations and the full event history remain in the evidence view. Stored task identifiers and entrance terms are separate from current proposals. A dependency failure without a receipt is labelled incomplete planning, not a checked infeasibility result. Simulator controls are enabled only when the server advertises them; no real booking or supplier purchase is made.

## Verification

```powershell
npm.cmd test
npm.cmd run test:postgres
npm.cmd run build
```

The standard suite includes the five TypeScript/React presentation and request tests. The PostgreSQL suite includes a real JSONB round-trip with seven chronological/tied missions, a retained failure and owner filtering, alongside prior concurrency/recovery checks.

For repeatable manual browser testing, `node --import tsx tests/helpers/browser-server.ts` starts two disposable loopback instances with temporary, separate SQLite/H-MEM directories. It never loads `.env`, clears sponsor configuration in its own process, blocks outbound fetch and prints its ephemeral origins and unique stop path. The authentication fixture uses a fixed **non-secret test credential** documented in that helper. It is not the user's Relay token. Its live configuration deliberately lacks dependencies; no hosted inference is claimed. Sample library planning is deliberately delayed to exercise stopping and retrying.

After testing, POST `{}` as JSON to the printed sample origin/stop path. The helper gracefully closes both applications and verifies its temporary directory before removal. Do not use the fixture with the live database or the user's sample data directory.

Actual browser checks covered draft → clarification → receipt → simulated approval; decline → replacement comparison → separate approval → cancellation; source depletion → rejected stale approval → replacement; ten visible history entries and keyboard filtering; unresolved authentication → test login → accurate NVIDIA-direct configuration/no sample map → retained dependency failure; and delayed request cancellation → persisted failure → successful explicit retry with the original deadline. A 390 × 844 viewport kept history visible, readable controls and no document horizontal overflow; the temporary viewport override was reset. Sanitized screenshots and exact observations are linked in [RELAY-09 evidence](../examples/recorded/relay-09-browser-2026-10-22.json).

These are actual browser interactions against isolated local fixtures, not a new live sponsor demo or external execution verification. Browser refresh/presentation does not renew evidence or extend a deadline. Pause for user testing before RELAY-10.
