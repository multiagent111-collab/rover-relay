# Optional entrance-memory integration service

This loopback service reuses Relay's existing MemoryAdapter and the official vendored Meterless H-MEM engine. It stores a confirmed entrance for `library` or `auditorium`, scoped by authenticated gateway subject and tenant. It has no provider-selection, model, reservation, messaging or execution capability.

Run `node --import tsx src/rover-memory-server.ts` with private environment variables:

- `RELAY2_MEMORY_PORT` (default 4194).
- `RELAY2_MEMORY_DATA_DIR`: a dedicated directory named `rover-memory-integration`.
- `RELAY2_MEMORY_INTERNAL_TOKEN` and `RELAY2_MEMORY_CONTEXT_SECRET`: distinct independently generated credentials of at least 32 characters.
- Optional `RELAY2_MEMORY_LOCAL_CONTROL_TOKEN`: 64 hexadecimal characters for authenticated graceful shutdown.

`tools/rover-memory/start.ps1` reads these from a private connection file supplied with `-ConnectionFile`. Its format is `contractVersion: rover-memory-connection-1.0`, `url` (local loopback base URL), `internalToken`, `contextSecret`, and `localControlToken`. Keep this file outside source control. The local start/stop scripts never wipe data or remove stale writer locks.

GET `/v1/health` reports the engine revision and protocol. POST `/v1/integration/entrance` requires both a bearer internal token and `X-Rover-Memory-Context`. The latter is base64url(JSON claims), a dot, then base64url(HMAC-SHA256 of the encoded claims). Claims bind `v: rover-memory-context-1.0`, canonical UUID `sub`, `tenant`, `aud: relay2-entrance-memory`, integer epoch-second `iat`/`exp`, UUID `jti`, `method: POST`, the fixed path, and exact raw-body `bodySha256`. Expiry is at most 30 seconds. Replay IDs are persisted before engine operations and checked after process restart.

Strict request bodies:

```json
{"action":"recall","placeId":"library"}
```

Confirmation adds `entrance`, `expectedRevision` from recall and `confirmed: true`; forgetting uses action `forget`, observed `expectedRevision` and `confirmed: true`. Stale revisions return 409. Callers cannot select identity in the body. The gateway must verify user identity and authoritative membership before signing; possession of a browser demo token grants no memory authorization.

Successful responses identify `entrance-memory-1.0`, official engine/context revisions, confirmed entrance or null, structured decision, `execution: none`, and `bookingCreated: false`. No user identity, raw H-MEM reinjection context or ledger text is returned. Runtime activity logs contain action, allowlisted place and revision, without entrance text or credentials.

Memory owns a separate directory, scope registry and writer lock. An existing unrelated store and another live writer are rejected. Preserve a corrupt store for inspection rather than resetting it. Back up the entire directory while stopped. Forgetting removes active future influence; private engine audit history retains deleted text, and a consuming application may retain historical request receipts. Configure a retention policy before production use.

Verification: `npm test`, `npm run build`, and `npm run verify:hmem`. New tests cover identity/tenant/place isolation, authorization/body binding, expiry/replay rejection across restart, stale corrections, corruption, one-writer protection and recall across separate OS processes. These are actual local engine tests with controlled identities, not hosted model calls. Original engine attribution and revision remain in `vendor/hmem/UPSTREAM.json` and LICENSE.
