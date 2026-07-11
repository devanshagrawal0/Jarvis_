# JARVIS Architecture

## Local Development

The local build uses a Node HTTP server plus a React/Vite client:

- `server.js`: local API, static file serving, provider masking, Gemini proxy, modules, projects, missions, devices.
- `src/App.tsx`: spatial shell, window manager, Jarvis command surface, modules.
- `runtime/*.json`: local development persistence.
- `config/jarvis-modules.json`: module registry and provider requirements.

## Production Target

Production target follows the spec:

```text
Browser clients
  -> Cloudflare Worker full-stack app
  -> Durable Object UserRoom for device presence, pairing, WebSocket events, WebRTC signaling
  -> D1 or Durable Object SQLite for devices, missions, receipts, conversations, layout state
  -> Gemini API through server-only secret
  -> WebRTC peer-to-peer camera streams
```

The server should signal WebRTC only. It must not ingest camera video in the first implementation.

## Capability Pipeline

```text
input -> session/device -> context -> intent -> permission -> execute -> verify -> receipt -> response -> optional memory update
```

Every module command must produce a verifier-backed receipt before the UI claims success.

