# Third party notices

## Meterless H-MEM reference

- Upstream: https://github.com/Meterless/Meterless
- Revision: `1742dec56a66e58eef9dda2d2b865823758ca8cd`
- Source subtree: `engines/hmem/reference/src`
- Included license: `vendor/hmem/LICENSE` (Apache License 2.0)
- Provenance: `vendor/hmem/UPSTREAM.json`
- Official conformance suite: `vendor/hmem/conformance/`, from the same pinned revision. `vendor/hmem/INTEGRITY.json` records Git blob hashes verified against the official revision; `npm run verify:hmem` checks them and executes the suite without a download.

The included upstream TypeScript source is unmodified. Relay's wrapper in `src/memory.ts` is newly authored application code. Retain the upstream source comments, license, and this attribution when distributing. A setup script can reproduce the pinned download; runtime execution does not download the engine.

Dependency package versions and their own licenses are preserved through `package-lock.json` and the installed packages. Zetaris and Nightshift services are separately provisioned; their binaries and proprietary service code are not bundled. NVIDIA models are accessed through the explicitly selected Runtime or NVIDIA-direct route; no model weights are included.

No license for newly authored Relay application code has been selected on the owner's behalf. Review and choose it before public distribution. This does not change the license of included third-party components.
