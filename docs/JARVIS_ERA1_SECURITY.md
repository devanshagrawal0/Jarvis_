# JARVIS Era I security operation

## Local default

`npm start` now binds to `127.0.0.1` unless `JARVIS_HOST` is explicitly set. Do not set `JARVIS_HOST=0.0.0.0` unless authenticated LAN access is intentionally required.

## Cloudflare owner relay

Remote API access requires two independent secrets:

1. `JARVIS_ACCESS_TOKEN` authenticates the user at the Worker.
2. `JARVIS_RELAY_SECRET` signs the Worker-to-local assertion.

Set the Worker secrets with:

```powershell
npm run cf:secret:access
npm run cf:secret:relay
```

Set the exact same relay secret in the local JARVIS process environment before starting the backend:

```powershell
$env:JARVIS_RELAY_SECRET = "<same high-entropy relay secret>"
npm start
```

The Worker refuses proxy mode when the relay secret is absent. The local server rejects unsigned, expired, path-mismatched and replayed relay assertions.

## Public bootstrap routes

Only the minimal health check, pairing claim/status bootstrap and the VAPID public key are public API routes. Creating a new pairing code, reading private state, chat/model calls, capability calls and confirmation decisions require an authenticated principal.

## Approval authority

Pending approval details and one-time challenges are available only on the direct loopback owner surface. A paired device or cloud-relayed client can prepare an action but cannot approve it. Approval and denial consume the challenge once; challenges expire with the underlying confirmation.
