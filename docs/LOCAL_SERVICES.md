# Local startup, status and graceful shutdown

Run these commands from the Relay repository. No private helper directory or private application checkout is required. The command reads your existing `.env` without rewriting it. Node 22.13+ and installed dependencies are required; run `npm.cmd ci` and `npm.cmd run build` in a new checkout.

## Inspect the current workstation first

```powershell
npm.cmd run local -- status
```

This reads local health/readiness, inspects the existing labeled PostgreSQL container when a database URL is configured, and runs a bounded read-only database connection check. It makes no model call or Zetaris query. It prints only bounded status, never private tokens, database URLs, Docker environment values or raw log bodies. It can report data and inference independently; a failure in one status check does not hide the others.

`configured` means required values are present, not that they work. `reachable` and `authenticated` remain `null` until a check or actual call establishes them. A provider authorization rejection establishes reachable `true` and authenticated `false`. A generic timeout/transport failure cannot establish either. `checkedAt` is the observation time; `lastExercisedAt` records the last successful operation, not a configuration save. API readiness observations belong to the current process and reset on restart. They are not an assertion of full workflow success.

`GET /v1/readiness` uses the same live Relay bearer authentication as `/v1/bootstrap`. It reports separate data, inference and simulator execution modes, the selected provider, response-reported model when available, and last actual adapter use. It never initiates sponsor calls. The legacy `sponsorCallsVerified=false` health field remains compatible and is explicitly deprecated; neither health nor configuration attests sponsor integration.

## Reuse the existing live stack

This workstation's existing arrangement is Relay on loopback port 4173, the independent supplier source on 4174, and `relay-courier-source` PostgreSQL on loopback port 15432 with its existing named data volume. Zetaris uses port 8888 and its shared Docker network to reach courier PostgreSQL; it reaches supplier HTTP through `host.docker.internal`. Nightshift normally serves port 8088. Use the actual private configuration if your setup differs.

1. Start Docker Desktop and the existing Zetaris platform using its own instructions. These commands do not install software, reconfigure WSL, replace containers, register sources or run a second Compose stack.
2. Inspect/start only the existing Relay PostgreSQL container:

   ```powershell
   npm.cmd run local -- start --service=postgres
   ```

   The container must have the Relay courier-source label, a persistent volume at PostgreSQL's data directory, and a loopback mapping matching `DATABASE_URL`. The command refuses a mismatch or missing container. It never creates, removes or replaces a volume/container. Its default name is `relay-courier-source`; `RELAY_POSTGRES_CONTAINER` can explicitly select another existing appropriately labeled instance.

3. Start/reuse the supplier and Relay:

   ```powershell
   npm.cmd run local -- start --system-ca
   npm.cmd run local -- status
   ```

   `--system-ca` gives only the newly launched child processes `NODE_USE_SYSTEM_CA=1`. Use a Node version that supports this setting. It preserves certificate validation and leaves global/user environment settings alone. Nightshift's separate bundled Node process must also inherit Windows trust from its own supported launcher if needed; changing Relay's `.env` after Node starts does not configure startup certificate trust.

A responding service is reused. A service with a different known configuration is refused. A legacy service started before this command existed is reported as external; it is never killed or silently adopted. A legacy supplier is recognized through its read-only inventory contract. Stop legacy instances in their original terminal/launcher before starting a managed replacement. Writer-lock enforcement applies to upgraded processes; do not run a new process on the same data directory alongside a legacy instance.

Nightshift remains an explicitly selected inference provider. RELAY-01 does not switch a working NVIDIA-direct route. Nightshift endpoint discovery alone does not prove a complete Relay mission. Full missions passed in RELAY-05 and RELAY-11; see [evaluation](EVALUATION.md) for the current dated proof and actual models. Under the October 22 user-supplied rule, the working official H-MEM feature and its passing feature/conformance tests are Meterless Engine evidence, disclosed as inherited functionality.

## Test a separate offline sample

With the existing live app left on 4173, use separate ports and data:

```powershell
npm.cmd run local -- start --sample --port=4183 --supplier-port=4184
npm.cmd run local -- status --sample --port=4183 --supplier-port=4184
```

Open `http://127.0.0.1:4183`. `--sample` explicitly clears the inherited database URL, uses SQLite, and selects `.data/sample` with separate supplier storage. It does not edit `.env` or call a sponsor. `--data-dir=.data/another-sample` selects a different isolated sample directory. Retain identical flags for status/stop. A clean default sample still needs no keys, Docker, GPU or external model.

Calling start twice returns the existing instance instead of another writer. Each Relay data directory has an exclusive `.relay-writer.lock`, and each supplier directory has `.supplier-writer.lock`. Canonical paths prevent aliases from creating a second writer on another port. Direct `npm.cmd start` and `npm.cmd run supplier` use the same protection. An occupied/Windows-reserved port is rejected before opening Relay's store or draining its outbox.

## Stop only processes this command started

```powershell
npm.cmd run local -- stop --sample --port=4183 --supplier-port=4184
```

Default start/stop manages the two application processes, not PostgreSQL. Use `--service=relay` or `--service=supplier` to select one. PostgreSQL stop requires explicit `--service=postgres` or `--service=all` and preserves the data volume.

Application stop verifies the launch/instance identity and uses a separate private, loopback-only control capability in the ignored process record. The control endpoint is absent on ordinary direct launches and cannot be used with the Relay browser token. It gracefully closes storage, releases the writer lock and leaves persisted data intact. It never force-kills an unknown process. Repeating stop is harmless.

Process records, private control capabilities and logs live under the selected data directory's `run/` folder. Keep all `.data/` content private. Treat logs as private diagnostic data; do not paste raw logs or credentials into public evidence. Back up `.env` privately before changing configuration; no configuration change is required by RELAY-01. The tracked `.env.example` is a template, not a rollback copy.

After an unclean exit, a stale writer lock is deliberately retained. Check the PID in the local lock file and confirm it is no longer running. Only then remove that single lock file and retry. Never delete or reset the database/H-MEM directory to fix a lock. Do not automatically remove a lock merely because an HTTP endpoint is unavailable.

## Explicit readiness checks

```powershell
npm.cmd run preflight -- --json
npm.cmd run preflight:live -- --component=memory --json
npm.cmd run preflight:live -- --component=zetaris --json
npm.cmd run preflight:live -- --component=inference --json
```

Plain preflight now always stays offline, including with `SAMPLE_MODE=false` in `.env`. Only `--live`/`preflight:live` authorizes service checks. The memory probe uses isolated temporary storage. Zetaris independently checks authenticated `SELECT 1` and the operational views; inference checks authenticated discovery where applicable and actual Planner/Critic payloads over synthetic records. Inference consumes provider quota and creates no dispatch. Response identity is not independent evidence of underlying Nightshift provenance. JSON includes timestamps and the distinct readiness states; errors do not contain raw provider responses or credential values.

On Windows, a port bind permission error may be an excluded TCP range even with no listener. Inspect `netsh interface ipv4 show excludedportrange protocol=tcp` and select a usable loopback port. For Docker's Ubuntu integration socket failure, save WSL work, quit Docker Desktop, run `wsl --shutdown`, then reopen Docker Desktop and verify its Ubuntu integration. A full WSL shutdown stops all WSL sessions. Do not unregister distributions or reset Docker data.

Before changing ports or inference providers, take a private rollback copy of `.env`, update all dependent addresses deliberately, and rerun only the affected component checks. A working configuration is preserved until replacement checks pass.
