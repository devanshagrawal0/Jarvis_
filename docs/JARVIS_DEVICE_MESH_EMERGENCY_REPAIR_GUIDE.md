# Jarvis Device Mesh Emergency Repair

## What changed

Device Mesh now has a working phone-first vertical slice.

- Server binds to `0.0.0.0`.
- QR pairing uses `/mesh/pair?code=...`.
- QR selection prefers stable/tunnel/LAN/Tailscale URLs before localhost.
- Localhost QR links are visibly flagged as unusable for phones.
- Phone dashboard is served at `/mesh`.
- Phone can send text, links, and files/photos.
- Mesh events are stored in a readable event log and mirrored into Neural Vault memory.
- Diagnostics/self-test writes `runtime/reports/DEVICE_MESH_SELF_TEST_REPORT.md`.

## Main routes

- `GET /mesh/health`
- `GET /mesh/pair?code=...`
- `GET /mesh`
- `POST /mesh/api/pair/request`
- `POST /mesh/api/pair/approve`
- `POST /mesh/api/heartbeat`
- `POST /mesh/api/inbox/text`
- `POST /mesh/api/inbox/link`
- `POST /mesh/api/inbox/upload`
- `GET /mesh/api/devices`
- `GET /mesh/api/events`
- `GET /mesh/api/inbox`
- `POST /mesh/api/device/:id/revoke`
- `POST /mesh/api/self-test`

## How to connect a phone

1. Open Jarvis on the laptop.
2. Open the Devices panel.
3. Click `Generate QR`.
4. Confirm the QR URL uses LAN/Tailscale/Cloudflare, not `localhost`.
5. Scan the QR on the phone.
6. Tap `Pair Device`.
7. The phone opens `/mesh`.
8. Send a text, link, or file/photo.
9. Confirm it appears in the laptop Device Mesh inbox.
10. Run `Self-Test` from the Devices panel if anything fails.

## Jarvis tools

Jarvis can call:

- `mesh_status`
- `mesh_pair_link`
- `mesh_self_test`
- `mesh_objects`
- `device_files`

## Verification

Run:

```powershell
npm run test:device-mesh-repair
npm run test:device-mesh-v2
```

The UI screenshot is saved at `output/playwright/device-mesh-v2-cockpit.png`.
