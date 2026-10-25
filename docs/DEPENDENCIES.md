# Dependency and attribution review

RELAY-13 inspected the current lockfile and installed direct-package manifests. No package version or license was changed. Node provides the sample SQLite runtime; npm installs application/build packages from the lockfile.

| Package          | Use         | Declared | Locked / installed | Package license metadata |
| ---------------- | ----------- | -------- | ------------------ | ------------------------ |
| fastify          | runtime     | 5.12.7   | 5.12.7             | MIT                      |
| pg               | runtime     | 8.23.1   | 8.23.1             | MIT                      |
| react            | runtime     | 19.3.1   | 19.3.1             | MIT                      |
| react-dom        | runtime     | 19.3.1   | 19.3.1             | MIT                      |
| tsx              | runtime     | 4.23.15  | 4.23.15            | MIT                      |
| zod              | runtime     | 4.6.7    | 4.6.7              | MIT                      |
| @types/node      | development | ^24.0.0  | 24.19.2            | MIT                      |
| @types/pg        | development | ^8.15.0  | 8.23.1             | MIT                      |
| @types/react     | development | ^19.0.0  | 19.3.0             | MIT                      |
| @types/react-dom | development | ^19.0.0  | 19.3.0             | MIT                      |
| prettier         | development | 3.9.10   | 3.9.10             | MIT                      |
| typescript       | development | 7.0.2    | 7.0.2              | Apache-2.0               |
| vite             | development | 8.3.4    | 8.3.4              | MIT                      |

The lockfile has **161** package entries, including optional platform packages that need not all install on one host. License-expression entry counts: MIT: 117; Apache-2.0: 22; BSD-3-Clause: 5; ISC: 5; MPL-2.0: 12. Missing license metadata: **0**. Entries without registry URL/integrity metadata: **0**. Full pinned metadata and counts are in the [final audit](../examples/recorded/relay-13-review-2026-10-22.json). These counts describe package metadata, not an assertion about all third-party code or service terms.

Retain each package's supplied license/notices when distributing installed/build output. This source candidate includes package-lock.json; it excludes node_modules and does not redistribute sponsor platforms or NVIDIA model weights. Bundled vendor-specific license files are not replaced by Relay documentation.

The official Meterless H-MEM source at revision 1742dec56a66e58eef9dda2d2b865823758ca8cd is unmodified. Its Apache-2.0 license is included in [vendor/hmem/LICENSE](../vendor/hmem/LICENSE), with provenance/integrity files and official conformance tests. [Third-party notices](../THIRD_PARTY_NOTICES.md) remain unchanged.

No license for Relay-authored application code has been selected on the owner's behalf. That choice remains a participant action before public event-source distribution. An npm package's license does not assign a license to Relay's own code.
