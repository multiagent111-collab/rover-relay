# Relay2 integration fork

Created 2026-10-23T19:15:05.973Z.

The original Relay checkout is preserved as the judging fallback. This independent checkout starts with its exact 186-file current-source candidate at parent c2b75e242f2dd87ec994acd4331b48ba823bdc93, including the inherited working-tree delta. No feature is reclassified as newly authored merely because it appears in this snapshot commit. Original event attribution and protected pre-event tag are retained.

Use this checkout for new generic Relay integration work. Keep private ROVER Android, backend, migrations, assets and credentials in the private ROVER repository. Do not copy them into this repository or publish them.

Track each new slice with dated Git commits, actual Codex attribution, tests and a development log. The user requests tracking through October 27, 2026; timestamps must reflect actual work. GitHub origin is retained, but this preparation does not push or publish. The private tracker must explicitly select Relay2 for new fork work instead of attributing it to the preserved original.

Runtime state, credentials and dependencies were not copied. Use a separate data directory and unused port. Do not share the original instance's database, H-MEM writer directory or process records. New integrations must preserve ordinary ROVER operation without optional Meterless/Nightshift or Zetaris services. Initial vehicle/service selection must use authoritative ROVER provider availability/capability data and explicit approval before any job.
