# Nightshift integration and verification (RELAY-05)

Nightshift 1.2.1 completed a real authenticated Relay planning mission on October 22, 2026. This went through the normal mission API, current proposal-2.0 Planner/Critic contracts, real Zetaris federation, official H-MEM and deterministic validation. It produced an approvable receipt in 16,474 ms, using two model invocations, three logical reads and one backend snapshot. No dispatch was approved or created. See the [mission report](../examples/recorded/relay-05-nightshift-mission-2026-10-22.json) and [discovery/policy experiment](../examples/recorded/relay-05-nightshift-discovery-2026-10-22.json).

## Actual route and provenance

The explicitly selected test route was `meterless/auto`, using app `rover-relay` and the existing Runtime token. Planner ran `nvidia/nemotron-3.5-super-vl-120b-a12b`; Critic ran `nvidia/nemotron-3-ultra-550b-a55b`. Both were NVIDIA cloud Nemotron responses and reported cache misses. Their HTTP response IDs and Runtime receipt IDs matched the Runtime's persisted receipt log. Planner receipt `rcpt_req_1szeotjo` reports 7,469 ms and Critic receipt `rcpt_req_wc0tswzs` reports 1,026 ms. Runtime timings exclude parts of the complete mission, so they are not substituted for the measured 16.5-second API duration. Runtime was already running; warm/cold state was not independently measured.

The configured `NEMOTRON_MODEL` label was Lightning. That label does not pin Nightshift routing, and the successful check explicitly accepted the routed NVIDIA Nemotron family. An exact-Lightning route is still unverified. Receipt correlation is Runtime-reported provenance; signatures were present but this implementation does not verify them cryptographically or independently attest NVIDIA's response.

The mission selected supplier-b:courier-2 at a checked $35 total and 28-minute estimate, with the isolated, explicitly confirmed North loading entrance. Selection among feasible candidates is the Planner's decision; it is not required to pick the cheapest option. Real Zetaris returned 18 observations; source queries and the exact receipt digest are in the report. Operational source records were read without modification. The temporary mission database and H-MEM writer were closed and removed after evidence capture.

## Routing policy observation

Health and authenticated model discovery first returned HTTP 200. One small real request returned a readiness response in 2,130 ms using Nemotron Ultra. A dedicated diagnostic app's attempted fast/one-wide policy did **not** control that request: its receipt reported auto/six-wide and no applied rule. The experiment is retained as a failed policy-control check, not counted as a successful model pin. The installed proxy also gives a saved app-mode binding precedence over the client's model/mode signal. Do not infer execution from a stored policy document or a discovered model ID.

Only the new idle diagnostic entry was removed from persisted app-policy state afterward. The existing rover-relay policy, global settings, Runtime process, provider keys and vendor code were preserved. No TLS bypass was used. The verification process inherited supported Windows certificate trust through `NODE_USE_SYSTEM_CA=1` before Node started.

## Product changes

`NightshiftGenerator` projects only bounded routing metadata into agent steps: response/receipt IDs, requested route, routed model/provider, app, requested/effective/bound modes, race width, cache status and optional Runtime latency. Receipt/request/model/provider mismatches fail with `nightshift_contract`. Runtime `requires_review` markers also block acceptance. Raw receipt bodies, prompt previews, deliberation and reasoning scaffolds are excluded. Plain compatible responses without Runtime metadata remain usable as responses but establish no Runtime provenance. NVIDIA-direct remains explicit; no fallback is introduced.

Preflight now separately reports Runtime-correlated Nemotron routing and equality with the expected model label. Thus an actual Nemotron route can have valid routing evidence while the Lightning-label equality check remains UNVERIFIED. This distinction is deliberate. The inherited preflight deadline increase to 180 seconds was present before RELAY-05 and is packaged with that attribution; mission budgets remain unchanged.

## Run your test

From the Relay directory, with the existing private Runtime/Zetaris/Relay credentials configured:

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm.cmd run verify:nightshift -- --live --accept-routed-nemotron
```

This explicitly performs one real planning mission and consumes service quota. It uses isolated temporary SQLite/H-MEM state, confirms a synthetic entrance, reads real Zetaris observations and requires correlated NVIDIA Nemotron evidence for every Planner/Critic response. It never approves dispatch, rewrites `.env`, changes Runtime policy, switches a running server or retries a failed mission. RELAY-04's single targeted repair may consume additional calls within the normal shared budget. Omit `--accept-routed-nemotron` to require exact equality with `NEMOTRON_MODEL` instead. A mismatch is reported after the bounded mission without silently changing routing. Use a new `--output=report.json` path to save the sanitized result; existing reports and non-JSON paths are refused before service calls.

All 81 behavior/adapter tests and production build passed. The final five focused Nightshift checks passed again after report-overwrite protection and review-required handling. Controlled tests cover provenance omission/conflict, requested/effective mode differences, private-field exclusion, exact-label mismatch, no provider fallback and explicit live authorization. The actual successful mission is separate evidence, not a controlled response.

The current running services were preserved: 4183 remains the offline sample and the older live server retains its NVIDIA-direct setting. This ticket verifies and implements Nightshift integration without silently moving those services. User testing is pending; stop before RELAY-06. Build/private ROVER work remains deferred.
