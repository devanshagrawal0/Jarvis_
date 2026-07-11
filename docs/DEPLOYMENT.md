# Deployment

## Target

- Cloudflare Workers full-stack React/Vite deployment.
- Durable Objects for a per-user real-time room.
- D1 or Durable Object SQLite for persistent records.
- Gemini key stored as a server-side Wrangler secret.

## Required Manual Preconditions

1. Sign in to a free Cloudflare account.
2. Run `npx wrangler login` and approve the browser login.
3. Add Gemini as a secret with `npx wrangler secret put GEMINI_API_KEY`.
4. Deploy with `npx wrangler deploy`.

Codex must not claim deployment is complete until the actual HTTPS URL is captured and smoke tested.

## Free Tier Boundary

Cloudflare free services have quotas. Camera streams are intended to be peer-to-peer WebRTC so the server only handles signaling. TURN/SFU fallback can create usage costs and must not be silently enabled.

