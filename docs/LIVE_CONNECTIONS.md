# Obtain credentials and verify each connection

## October 22 RELAY-05 current Nightshift verification

An isolated full Relay planning mission now passed through Nightshift 1.2.1 with real Zetaris observations and official H-MEM in 16.5 seconds. Runtime receipts correlate Planner to NVIDIA Nemotron Super VL and Critic to Nemotron Ultra, both cache misses. This verifies actual meterless/auto routing, not exact Lightning pinning. Existing private .env and running services retain NVIDIA-direct; there is no automatic fallback or server switch. Use [NIGHTSHIFT_VERIFICATION.md](NIGHTSHIFT_VERIFICATION.md) for the explicit quota-consuming check and actual evidence. Historical October 21 records below remain as originally observed.


For reproducible startup, current ports, safe shutdown and the distinction between configured/reachable/authenticated/exercised, use [local service operations](LOCAL_SERVICES.md). Plain preflight is now explicitly offline even with a live `.env`; use `preflight:live` for intentional service checks. The existing provider is not switched by RELAY-01.

Official H-MEM is already included and needs no account key for local memory. Run `npm.cmd run verify:hmem` to verify source integrity and the 13 official conformance checks. Sponsor accounts, credits and inference access are separate.

## Private Relay configuration

Work from your cloned `rover-relay` directory. If `.env` is absent, copy `.env.example` to `.env`; preserve existing settings. Generate a private random `RELAY_ACCESS_TOKEN` of at least 24 characters before enabling live mode. That token protects Relay only. Keep credentials out of chat and source control.

Check individual services before all credentials are available:

```powershell
npm.cmd run preflight:live -- --component=memory
npm.cmd run preflight:live -- --component=inference
npm.cmd run preflight:live -- --component=zetaris
```

These explicit live checks call the selected configured services even while the app remains in sample mode. Inference checks perform planning/critique over synthetic records and consume provider quota. They create no dispatch task. Ordinary `npm.cmd run preflight` always stays offline; `--live` is required to call services.

## Zetaris: register, install, create an API key

1. Register/sign in at https://cloud.enterprise.zetaris.com/register.
2. Open Run locally: https://cloud.enterprise.zetaris.com/dashboard/download. Download `zetaris-platform.zip`, matching configuration, and registry login details. Ask https://www.zetaris.com/support for account enablement if the download is missing.
3. Start Docker Desktop and follow https://github.com/zetaris/getting-started/blob/main/docs/install/updated_zetaris_installation_guide.md. Windows uses WSL 2 with Docker integration. The current bundle uses `zetarishackathon.azurecr.io` and Zetaris-issued credentials, rather than the older Freemium Docker Hub procedure.
4. Configure your administrator identity/password in the platform's own `.env` before bootstrap. Run its supplied preflight and verifier. The documented UI is http://localhost:3000; use your actual bundle settings.
5. Open Management -> API Tokens -> +. Create an API key and save it privately in Relay's `.env` as `ZETARIS_API_KEY`. Copy Management -> Organisation -> numeric ID into `ZETARIS_ORG_ID`.
6. Set `ZETARIS_REST_URL=http://127.0.0.1:8888/api/v1.0` when Relay runs on the same host, or your actual API address. A container needs a reachable host address instead of its own loopback. The GUI URL is not the API base.
7. Run the Zetaris component check. `SELECT 1` proves authenticated SQL access; the separate operational-view check requires independent supplier/courier sources and Relay's views from [SPONSOR_SETUP.md](SPONSOR_SETUP.md). Source registration/DDL is not executed automatically.

Official token and ID instructions: https://github.com/zetaris/getting-started/blob/main/docs/connections/client-setup.md.

## Nightshift with NVIDIA-hosted Nemotron

1. Obtain the supported Windows edition using the Windows link in https://github.com/Meterless/Meterless. Complete vendor installation/account/license steps. H-MEM alone does not install the Runtime.
2. Sign in at https://build.nvidia.com/ and generate an NVIDIA API key. The initial model candidate is https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/build. Verify access/quota on your account. Hosted inference needs no local model-weight download.
3. Configure NVIDIA and a Nemotron-backed lane inside Nightshift using that NVIDIA key.
4. Obtain Nightshift's real URL and Runtime token from its Console. In Relay set `RELAY_INFERENCE_PROVIDER=nightshift`, `METERLESS_BASE_URL`, `METERLESS_RUNTIME_TOKEN`, and an actual discovered `METERLESS_ROUTE`. The default local base is `http://127.0.0.1:8088/v1`. The placeholder `rt-local` is invalid.
5. Set `NEMOTRON_MODEL` to the expected underlying model ID; this label does not configure the lane.
6. Run the inference check. It verifies discovery and schema-valid Planner/Critic calls. A response reporting only a `meterless/*` route leaves Nemotron identity UNVERIFIED; correlate Runtime receipts with the actual underlying model.

The adapter sends bearer authentication and the required application/scope headers. Contract: https://www.meterless.ai/engines.html.

## Explicit NVIDIA-direct development route

While Nightshift is unavailable, select direct inference explicitly:

```dotenv
RELAY_INFERENCE_PROVIDER=nvidia
NVIDIA_API_KEY=<your private NVIDIA Build key>
NEMOTRON_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
```

Run the inference check. This uses `https://integrate.api.nvidia.com/v1/chat/completions`, reports `nvidia-direct` in receipts, and never switches provider automatically. Direct access does not verify Nightshift. Confirm any hackathon exception to the Nightshift-primary rule with a human organizer.

## Enable the application

After independent checks pass, run `npm.cmd run preflight:live` for all checks. Fill the actual source-view settings and Relay access token, then set `SAMPLE_MODE=false` and run `npm.cmd start`. Operations remain simulated even with real sponsor calls. Demonstrating federation requires connector/query evidence for distinct sources.

Credit redemption remains unconfirmed. Installing a platform or generating a token does not activate sponsor credits.

## October 21 verified local configuration

The current workstation uses host Relay at http://127.0.0.1:4173, explicit NVIDIA-direct inference, the local Zetaris API on port 8888, an independent supplier HTTP service on port 4174, and PostgreSQL published only on loopback port 15432. Zetaris reaches PostgreSQL through the shared Docker network and the supplier through host.docker.internal. Start Docker Desktop and the Zetaris platform before Relay; keep the supplier service running. The PostgreSQL container is named relay-courier-source. These existing processes are separate from the optional Compose profile.

For local Zetaris connector provisioning, inspect [source registration templates](../db/zetaris-sources.example.sql), then [the executed view definitions](../db/zetaris-views.sql). Apply db/source-views.sql in PostgreSQL first, and supply a private read-only reader password. Templates contain no credentials and are never automatically executed.

Windows certificate trust was needed for Node HTTPS requests on this workstation. With a supported Node version, launch Relay from PowerShell using:

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm.cmd start
```

This uses the Windows certificate store and preserves TLS verification. The variable must be present before Node starts; a setting read later from .env is insufficient. The current background launch scopes it to the Relay process. Nightshift's bundled Node 22.23.2 required the same inherited setting. An offline UI warning can be checked against /healthz and authenticated /v1/models; endpoint reachability alone does not prove inference works.

The tested route is NVIDIA-direct with official H-MEM, not a verified complete Nightshift route. Keep the explicit provider setting until Nightshift completes a real mission successfully. See [the live verification record](VERIFICATION.md).
