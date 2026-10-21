# Verification record

## October 21 sponsor-readiness update

- 28 automated behavior/adapter tests passed, including explicit NVIDIA-direct authentication, provider selection, controlled quota errors, independent preflight results, and refusal to attest Nemotron from a routing ID.
- TypeScript checking and Vite production build passed.
- 15 official H-MEM source/license/conformance files matched Git blob hashes from the pinned upstream revision `1742dec56a66e58eef9dda2d2b865823758ca8cd`.
- All 13 unmodified official H-MEM conformance checks passed using `npm.cmd run verify:hmem`.
- Sample preflight passed actual H-MEM persistence, correction and forgetting without network calls.
- Live preflight independently reports missing Runtime token/route and Zetaris API settings. The Relay-only access token is configured privately. No successful live Nemotron inference, actual Zetaris query, source registration, federation, Nightshift installation, PostgreSQL run or sponsor-credit activation is claimed.
- New code and checks were authored with Codex. These changes do not establish Cursor use or a post-opening build timestamp.

## October 20 initial iteration

Date: October 20, 2026. Environment: Windows, Node 26.2.0.

- **23 automated tests passed** using Node's test runner. Behavior coverage includes stock and route disruptions, expired plans, idempotency, outbox recovery, task progression, H-MEM restart/correction/forgetting, identity isolation, input rejection, bounded failures, and sample-mode network isolation.
- **Production build passed:** TypeScript type checking and Vite asset generation.
- **Sample preflight passed:** actual official H-MEM store persisted a confirmed entrance, and a new engine instance recalled it. No live sponsor calls were attempted in sample preflight.
- **Three actual offline runs recorded:** feasible request, infeasible budget, and source disruption/replan. Outputs and ordered JSONL evidence are in `examples/recorded/`.
- **Browser workflow verified:** confirmed an entrance; generated the $32/22-minute plan; changed supplier stock to zero; rejected the old approval; displayed the replacement $35/28-minute plan; created one simulated dispatch task; accepted it in the simulator; inspected the Critic's rejection and Planner's revision in the evidence tab. The browser reported no console errors or warnings during this flow.
- **Screenshots inspected:** `screenshots/iteration-one.png` is the complete verified page; `screenshots/preview.png` is the initial viewport of that same simulated acceptance state.
- **Compose sample configuration validated.** Docker container execution and PostgreSQL integration were not tested because the Docker Linux daemon was not running.

Sponsor adapters have controlled-response contract tests for the Nightshift headers/routing and response identity, authorization and parse failures, Zetaris SQL request shape, typed numeric conversions, source freshness, identifiers, and bounded response sizes. These tests are not evidence of real Zetaris, Nightshift, or NVIDIA inference success. Configure the services and record actual calls before making those claims.

The preview initially could not be reached while its process was sandboxed. Launching the local server with host access resolved that environment limitation. The verified app still binds only to `127.0.0.1` by default.

No private ROVER files were changed, and nothing was deployed, published, or submitted. The entire iteration is pre-event work and is declared in `PRIOR_WORK.md`.
