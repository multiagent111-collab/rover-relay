# Event workflow and RELAY-00 checkpoint

## Current working agreement

On October 22, 2026, the user reported that Cursor credits are unavailable and any coding agent is permitted. Work in this session is attributed to **Codex**. Earlier Cursor-only instructions are superseded for current work; historical records retain their original attribution.

The user supplied this Meterless requirement: implement at least one Meterless Engine (H-MEM, Markovian, World Model or Scout Intent) in a working product feature, then demonstrate it with a passing test or live demo. Relay's existing confirmed entrance feature uses the real pinned H-MEM engine. That inherited feature is not newly authored RELAY-00 work. Its behavior test must pass before citing it as current evidence.

Complete one work-package prompt at a time and stop for user testing after each. Do not automatically advance from the onboarding helper into subsequent packages. Build changes and ROVER-01 through ROVER-04 are deferred at the user's request. Public Relay remains independently runnable.

Nightshift integration is requested separately as RELAY-05. A healthy Nightshift endpoint and a small inference request do not prove Relay's complete Planner/Critic mission. Preserve the working provider configuration until an explicitly selected Nightshift route passes its full workflow checks. No automatic provider fallback.

## Starting checkpoint

- RELAY-00 started on October 22, 2026 at **11:02:31 AM PDT / 18:02:31 UTC**, using the actual local tracker and `--tool Codex`.
- Starting branch: `main`.
- Starting HEAD and protected tag `rover-relay-pre-event-2026-10-21`: `1b19c528d639134691289d9c0db38d82e9f277ff`.
- Local event branch: `codex/relay-hackathon-2026`. Creating the branch carries existing changes; it does not establish their creation time.
- The starting checkpoint recorded 61 covered public source/document hashes. The hash ledger is consistency evidence, not an independent trusted timestamp or proof of line-level authorship.
- No files were staged at the start. No inherited changes are being committed as newly authored work in this ticket.

The entire tagged implementation remains pre-existing work as declared in [PRIOR_WORK.md](PRIOR_WORK.md) and [BASELINE.md](BASELINE.md). The inherited dirty tree is separate from that tag:

| Existing change | Review and provenance |
|---|---|
| `src/agents.ts`, `src/preflight.ts` | Earlier Codex integration: bounded JSON output, truncation rejection, explicit timeouts and Planner/Critic semantics. Preserved unchanged by RELAY-00. |
| `tests/adapters.test.ts` | Earlier adapter contract/truncation checks. Preserved unchanged. |
| `db/source-views.sql` | Earlier PostgreSQL JSON qualification and UTC timestamp projection. Preserved unchanged. |
| `compose.live.yaml` | Earlier October 22 troubleshooting moved the loopback database port from 54329 to 15432. Preserved unchanged. |
| `docs/LIVE_CONNECTIONS.md` | Earlier live connection instructions and current database port. Preserved unchanged. |
| `docs/DEVELOPMENT_LOG.md`, `docs/VERIFICATION.md` | Earlier factual integration/verification records. Preserve existing entries; add new dated records separately. |
| `db/zetaris-sources.example.sql`, `db/zetaris-views.sql` | Existing untracked public connection templates and federation definitions, with placeholder credentials. Preserved unchanged. |
| `examples/recorded/live-verification-2026-10-21.json` | Existing untracked evidence of eight earlier live checks using NVIDIA-direct. It is not Nightshift mission evidence or new RELAY-00 implementation. |

The review observed eight modified tracked paths and three untracked candidate files. Earlier records attribute the integration to Codex; a later commit or this checkpoint cannot reconstruct every inherited hunk's creation time. Unknown provenance remains unknown.

## What RELAY-00 changes

Only workflow/rule documentation and the new local event branch. The existing boundary rule is retained; the event rule adds the current user instructions. No application behavior, provider selection, credentials, database records, source fixtures or H-MEM runtime state are changed.

Private before-edit copies and the inherited patch are retained outside the public repository. The private tracker is not a public artifact. The protected baseline tag and its source manifest are not regenerated.

## Verification and user testing

Run from the Relay repository:

```powershell
npm.cmd run verify:baseline
npm.cmd run check:public
node --import tsx --test --test-name-pattern 'confirmed H-MEM preference' tests/workflow.test.ts
```

The memory feature test uses isolated temporary storage. It verifies confirmed entrance persistence across reload, injection into planning, changed approval terms, and forgetting. It does not write to the live H-MEM directory or call a hosted model. Source integrity/conformance can be checked with `npm.cmd run verify:hmem`.

The tracked-source checker does not cover untracked files; RELAY-00 also reviews all nonignored source/document candidates and checks the starting hashes of inherited source files. Actual outcomes are recorded in [VERIFICATION.md](VERIFICATION.md).

For this inventory-only package, review this agreement and confirm the running Relay remains usable. Do not restart or reset the live application merely to test a documentation change. After the user's test checkpoint, the next ordered package is **RELAY-01: startup and readiness**. RELAY-05 is the separately requested Nightshift integration gate; private ROVER packages remain deferred.
