# Judge quickstart

Use the reviewed event source with Node 22.13+ and npm. Actual RELAY-12 verification records the tested platform/version and source hashes in `examples/recorded/relay-12-setup-2026-10-22.json`. No private helper checkout is required.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run local -- start --sample --service=relay --port=4183 --data-dir=.data/judge-manual
```

Open <http://127.0.0.1:4183>. The UI must say offline sample/simulated. This mode needs no sponsor credentials, Docker or GPU. `--sample` explicitly clears an inherited database URL. On macOS/Linux substitute `npm`. A pre-existing listener may require another usable port.

Confirm **North loading entrance** for the auditorium. Create two HDMI-USB-C adapters, $35, 30 minutes. Inspect $32/22 minutes, evidence and memory. Before approval, set Supplier A stock to zero in demo controls. Approve the stale version and inspect the replacement $35/28 minutes. Explicitly approve that new plan to create one simulated task. Inspect the decline/cancel controls if desired.

Restore demo fixtures before testing $30: it must be infeasible with a $2 minimum budget increase. Fixture restoration affects sample operational fixtures, not memory or history. Recorded HTTP examples are in the setup report's `HTTP workflow` phase with actual UTC capture times. They deliberately stop before dispatch approval. Seven additional measured cases include confirmed memory effects, stock/route disruption and deadlines; their fixed business clock is labeled separately from wall-clock capture time.

For an automated clean-source reproduction:

```powershell
npm.cmd run verify:setup
```

This needs Git to enumerate current tracked/untracked source. It exports current candidate bytes, not old HEAD, and runs a separate locked install/build and actual loopback HTTP checks. Default installation can contact npm. `npm.cmd run verify:setup -- --offline` uses only an existing package cache. Neither mode permits sponsor calls during sample execution. Temporary data/export are closed and removed. A new report is saved under `.data/judge/`; it never overwrites public historical examples.

Stop the managed manual sample with matching flags:

```powershell
npm.cmd run local -- stop --sample --service=relay --port=4183 --data-dir=.data/judge-manual
```

For an entirely fresh run, use a new directory such as `.data/judge-manual-2`. Keep the old directory as a backup. To preserve memory/history, use the same directory after stopping. Do not delete a store or writer lock while its process may still run. Direct launches stop with Ctrl+C; `local` refuses to stop an instance it did not start.

## Troubleshooting

| Symptom                                        | Action                                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid Relay access token required in sample    | Check the URL and run matching `local ... status --sample` flags. Another port may serve a live instance. Sample needs no token. Live uses `RELAY_ACCESS_TOKEN`, not Runtime/NVIDIA credentials |
| Bind permission error without a listener       | On Windows inspect `netsh interface ipv4 show excludedportrange protocol=tcp`; choose another usable loopback port, retaining matching status/stop flags                                        |
| Writer lock                                    | Check the owning process before removing a confirmed stale lock. Never start a second writer against the same H-MEM directory                                                                   |
| `npm ci --offline` misses a package            | Run ordinary `npm.cmd ci` with registry access, then retry. Installed dependencies from another checkout are not a clean locked install                                                         |
| H-MEM integrity failure                        | Preserve `vendor/hmem`, compare upstream pinned hashes and attribution. Do not regenerate the protected baseline to hide a mismatch                                                             |
| Docker/WSL integration failure                 | Offline sample needs neither. For live operation save WSL work before restarting Docker/WSL; preserve volumes and distributions. Follow [local operations](LOCAL_SERVICES.md)                   |
| Live Runtime offline/no compute source         | Configure the supported Nightshift installation and provider in its Console. Endpoint health alone does not verify inference                                                                    |
| Source/inference timeout or invalid provenance | Inspect sanitized error/readiness and your own service access. No fallback occurs. Use explicit component checks in [sponsor setup](SPONSOR_SETUP.md)                                           |

## Live prerequisites

Provision your own supported Zetaris and Nightshift services; this repository does not bundle them. Use [.env.example](../.env.example), [source registration](SOURCE_EVIDENCE.md), public SQL templates and [sponsor setup](SPONSOR_SETUP.md). You need a restricted PostgreSQL source reader, independently persisted supplier HTTP reachable from Zetaris, federated candidate/route views, Zetaris API key/org ID, a Nightshift Runtime token and a Nemotron-backed route. Relay's separate access token protects the browser API. Never put these values in recordings or source.

After explicit setup, `preflight:live -- --component=zetaris --json` checks data. `verify:nightshift -- --live --accept-routed-nemotron` consumes provider quota and attempts a full isolated mission without dispatch. The latter accepts routed Nemotron family identity rather than exact Lightning equality. Review its real report before making a live claim. Do not launch an optional Compose stack alongside an already running stack or overwrite source registrations.
