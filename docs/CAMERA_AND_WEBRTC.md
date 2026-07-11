# Camera And WebRTC

## Browser Camera Rules

- Camera and microphone require HTTPS or localhost.
- Browser permission cannot be bypassed.
- The camera module must show denied-permission recovery instructions.
- No frame may be sent to Gemini unless the user explicitly asks for analysis or starts a named monitoring mission.
- Closing or stopping the camera must stop every media track.

## First Implementation

- Enumerate devices after permission.
- Switch by exact `deviceId` when available.
- Support Low, Balanced, and High profiles.
- Show local preview, FPS/status, snapshot, stop, and permission state.
- Prepare signaling messages for WebRTC offer/answer/ICE through the UserRoom Durable Object.

## Verification Boundary

Local preview can be verified on the laptop browser. Cross-device live streaming requires deployed HTTPS and two active paired devices.

