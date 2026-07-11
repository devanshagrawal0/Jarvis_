# User Setup Steps

This file must be updated with the actual production URL after Wrangler deployment.

## Cloudflare

1. Sign in to a free Cloudflare account.
2. Let Codex run `npx wrangler login`.
3. Approve the browser login.
4. Let Codex run `npx wrangler secret put GEMINI_API_KEY`.
5. Paste the Gemini key into the secure Wrangler prompt, not into source files.
6. Let Codex run `npx wrangler deploy`.

## Laptop

1. Open the final HTTPS URL.
2. Open Provider Health and confirm Gemini status.
3. Open Device Mesh and make the laptop the primary device.
4. Open Camera Matrix and press Enable Camera.
5. Choose Allow when the browser asks for camera permission.

## iPhone / iPad

1. Open the same final HTTPS URL in Safari.
2. Pair using the code shown in Device Mesh.
3. Open Camera Matrix.
4. Press Enable Camera and choose Allow.
5. Select the front or rear camera if both are available.
6. Keep the page open while streaming.

