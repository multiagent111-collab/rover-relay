# Run the Relay webpage locally

The public component is a standalone React/TypeScript webpage and local Node API. It demonstrates the agent architecture in a campus-equipment scenario. It is separate from the native ROVER fleet UI. The native integration is demonstrated in the video, deck and sanitized evidence; judges do not need to install ROVER.

## Requirements

- Node.js 22.13 or newer and npm. An initial dependency installation needs internet access.
- A browser. Git is needed for cloning and source-review commands, not for running the source ZIP.
- The offline sample needs no Docker, Android Studio, JADE, LiveKit, rented VM, GPU, sponsor account or access token.

## Recommended: use this entry's exact source copy

Open a terminal in `03_Source/rover-relay`, or extract `03_Source/Relay-Entry-Source.zip` into a new directory first. Do not copy a workstation `.env` into it.

Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run build
$env:RELAY_JUDGE_PORT = '4213'
$env:RELAY_JUDGE_DATA_DIR = '.data/entry-judge'
node --import tsx scripts/judge-local.ts
```

macOS/Linux:

```sh
npm ci
npm run build
RELAY_JUDGE_PORT=4213 RELAY_JUDGE_DATA_DIR=.data/entry-judge node --import tsx scripts/judge-local.ts
```

Open <http://127.0.0.1:4213/?venue=auditorium>. Keep the terminal running. Stop with Ctrl+C. This launcher explicitly selects OFFLINE SAMPLE and never loads a live `.env`. If 4213 is occupied, choose another unused port and update the URL. Reuse the same data directory to preserve memory/history after a clean stop. Use a different new directory for a separate test. Never share a live H-MEM writer directory between processes or delete its lock while it may still be running.

## Two-minute hands-on check

1. Confirm an auditorium entrance, such as `North loading entrance`.
2. Request two USB-C/HDMI adapters, within 30 minutes, for $35 including delivery.
3. Inspect the checked $32 / 22-minute sample option and Evidence & agent steps. Official H-MEM is real; Planner/Critic outputs and data sources in this mode are deterministic samples.
4. Before approval, use the demo stock-disruption control. The old proposal must require a fresh review/approval; the sample replacement starts at $35 / 28 minutes.
5. Explicitly approve the fresh proposal and use the simulator controls. This is a simulated task, not a purchase or vehicle booking.
6. Restore sample fixtures and try $30. The sample reports infeasibility rather than relaxing the budget. Fixture restoration does not erase saved memory/history.

These amounts and timings are synthetic examples, not real quotes or travel predictions. Proposals expire. Refresh/replan if a recording or delay outlasts the approval window.

## Verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run verify:hmem
```

Use `npm` instead of `npm.cmd` outside Windows. `npm run check:public` and `npm run verify:setup` enumerate files with Git and should run in a Git checkout. For a ZIP extraction, `git init` and `git add .` can create a local review index first. Neither command publishes anything.

## Public repository

<https://github.com/multiagent111-collab/rover-relay>

The public main branch was checked during packaging and still pointed to the pre-event baseline `1b19c528d639134691289d9c0db38d82e9f277ff`. Do not assume that cloning that branch reproduces this entry until the reviewed source update has been published. Use the included source ZIP meanwhile. `PUBLICATION_STATUS.json` and `Publish_Relay_Only.md` record the exact prepared source and update procedure.

## Optional real sponsor reproduction

The source contains Zetaris and Nightshift adapters plus setup documents. Actual external calls require your own supported installations, model route and credentials. See the source's `docs/SPONSOR_SETUP.md`, `docs/SOURCE_EVIDENCE.md` and `docs/HACKATHON_ENTRY.md`. Do not present sample fixtures as live federation or hosted inference. Native ROVER reproduction additionally needs proprietary host code and is outside the public setup instructions.
