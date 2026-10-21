# Development record

## October 21 2026 sponsor-readiness update

Authored with Codex. Verified the vendored H-MEM source against its pinned official GitHub tree, included the unmodified official conformance suite, and added reproducible offline integrity/conformance verification. Added explicit NVIDIA-direct inference alongside the default Nightshift route, with no automatic fallback and response-reported provider/model identity. Preflight now checks memory, inference and Zetaris independently, separates authenticated SELECT 1 from operational views, and leaves ambiguous Runtime model attribution UNVERIFIED.

Added credential-acquisition instructions for the updated Zetaris bundle, Nightshift Runtime token, and NVIDIA Build key. No vendor account, sponsor credit redemption, platform installation, source DDL, deployment or public submission was performed. The user confirmed sponsor credentials are not yet available. A local ignored .env was prepared with a Relay-only access token and blank sponsor credentials.

Verification: 28 behavior/adapter tests passed; TypeScript/Vite production build passed; all 13 official H-MEM conformance checks passed. Live preflight reports missing sponsor settings rather than claiming inference or federation success. Network access to fetch upstream verification files required host permission; the actual upstream bytes were verified before inclusion. Final run results are recorded in VERIFICATION.md.

## October 20 2026 initial iteration

Authored with Codex from the standalone Relay specification. Implemented the API, local simulator, domain checks, browser UI, bounded agent contracts, official H-MEM integration, sponsor adapters, sample fixtures, PostgreSQL option, packaging, documentation, and behavior/adapter tests.

Verification performed: TypeScript check and Vite production build; 23 passing automated tests; H-MEM persistence/recall preflight; three recorded offline sample runs; Docker Compose sample configuration validation. The Docker Linux daemon was unavailable, so no container or PostgreSQL execution result is claimed. Browser verification results are recorded in `VERIFICATION.md` after the final preview check.

Live Zetaris, Nightshift, and Nemotron calls are pending service configuration. No Cursor development evidence exists for this iteration. Future Cursor sessions should add concrete tasks, reviewed changes, and actual test results here.
