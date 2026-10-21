# Pre-event baseline

Repository: https://github.com/multiagent111-collab/rover-relay

Annotated baseline tag: [`rover-relay-pre-event-2026-10-21`](https://github.com/multiagent111-collab/rover-relay/tree/rover-relay-pre-event-2026-10-21).

Build opening: **October 22, 2026, 00:00 UTC**, equivalent to **October 21, 2026, 5:00 p.m. PDT**. The tag is created and pushed using actual system timestamps; no dates are backdated. The tag and GitHub's repository/commit records provide the remote snapshot. A baseline tag supplements the prior-work declaration; it is not a substitute for the final submission form.

## What already exists

The whole tagged application is pre-existing work: API, UI, campus fixtures, domain checks, Planner/Critic loop, simulated dispatch, persistence, contracts, vendor code, tests, examples, setup instructions and sponsor adapters. October 21 additions include official H-MEM conformance verification, explicit NVIDIA-direct inference, independent service preflight, and repository preparation. These additions are not eligible as new work during the event.

Verified locally before publication:

- 28 application/adapter tests pass.
- TypeScript checking and the Vite production build pass.
- Official H-MEM matches pinned revision `1742dec56a66e58eef9dda2d2b865823758ca8cd`; its 13 unmodified upstream conformance checks pass.
- H-MEM persistence, correction and forgetting work locally.
- The default sample preflight makes no external calls.
- Three recorded offline sample workflows and their evidence are included.

Unverified: live Zetaris access and federation, Nightshift/Nemotron inference, PostgreSQL/container execution and sponsor-credit activation. No actual Cursor development is claimed. Models and data are deterministic sample substitutes by default; operations remain simulated even in the intended live sponsor configuration.

## Exact source inventory

`SOURCE_MANIFEST.json` records the SHA-256 of each Git-stored file in the baseline, excluding the manifest itself to avoid a circular hash. Text is stored with LF line endings. `.env`, local state, installed dependencies, generated build files and private ROVER material are excluded. The Git commit hash also covers the manifest.

Verify the published snapshot:

```sh
git fetch origin --tags
npm ci
npm run verify:baseline
```

The verifier checks the immutable tag's tree, so later event commits do not require changing this baseline manifest. To compare the final submission against existing work:

```sh
git diff --stat rover-relay-pre-event-2026-10-21..HEAD
git log --reverse rover-relay-pre-event-2026-10-21..HEAD
```

Retain this tag, declare the baseline in the submission form, and identify new work honestly in the final README, deck and video. See `PRIOR_WORK.md` and `HACKATHON_REQUIREMENTS.md`.
