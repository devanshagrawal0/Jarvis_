# Security And Permissions

## Secret Handling

- Gemini, Cloudflare, TURN, Twilio, Kalshi, Google, GitHub, and Figma credentials stay server-side.
- Public settings routes return provider status only, not secret values.
- Do not commit `runtime/settings.json` or any parent `secrets/` directory.

## Permission Classes

- Observe: read status, inspect modules, provider health.
- Prepare: create drafts, snapshots, artifacts.
- Execute: move windows, start camera, run agents.
- Commit: send email, trade, delete files, submit forms, remote desktop control.

Commit-class actions require explicit user confirmation at action time.

## Emergency Stop

Emergency Stop must:

- Stop camera and microphone tracks.
- Close WebRTC peer connections.
- Close or mark WebSocket sessions inactive.
- Pause/cancel running missions.
- Create an audit receipt.

