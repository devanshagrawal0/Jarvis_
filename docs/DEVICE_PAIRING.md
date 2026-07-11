# Device Pairing

## Goal

Pair laptop, iPhone, and iPad into one Jarvis room without VPN.

## Flow

1. Primary browser opens Device Mesh.
2. Server creates a short-lived six-digit pairing code.
3. Secondary device opens the same HTTPS URL and enters the code.
4. Device reports capabilities: camera, microphone, touch, screen size, WebRTC, notifications.
5. Primary approves the device.
6. Both devices connect to the same Durable Object room over authenticated WebSocket.

## Local Development Boundary

Local routes can create and list device records, but cross-network phone/iPad proof requires the public HTTPS deployment.

