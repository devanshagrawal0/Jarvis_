# Known Limitations

- Cloudflare deployment is blocked until the user authenticates Wrangler or supplies a scoped API token.
- Gemini live responses require a server-side `GEMINI_API_KEY`.
- Camera access requires the user to open the page and choose Allow in the browser prompt.
- iPhone and iPad can suspend JavaScript, camera, WebSocket, or WebRTC when backgrounded or locked.
- Browser-only Jarvis cannot inspect local files, control laptop apps, or scan the desktop from a hosted site without a later installed local agent.
- Direct WebRTC can fail on restrictive networks; TURN/SFU fallback may eventually be needed and may cost money.
- Current verified implementation is a local development vertical slice, not yet the production cross-device proof.

