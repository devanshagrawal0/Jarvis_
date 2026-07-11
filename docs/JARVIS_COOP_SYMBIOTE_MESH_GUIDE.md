# Jarvis Co-Op Symbiote Mesh Guide

Jarvis Co-Op Symbiote Mesh is a private two-person collaboration workspace for Devansh and one trusted friend. It connects by short session code, shares a secret-scanned source tree, supports chat, patch proposals, Patch Court review, Ghost Sandbox verification, Jarvis-to-Jarvis bridge messages, tasks, memory packets, skill transfer, replay, and Neural Vault storage.

## Host Setup

1. Open Jarvis.
2. Open `Co-Op`.
3. Click `Create Symbiote Session`.
4. Copy the session code or invite link.
5. Send it only to a trusted friend.
6. Review the join request.
7. Approve the guest.
8. Work in suggest/patch mode first.

## Friend Setup

1. Open their own Jarvis.
2. Open `Co-Op`.
3. Enter the session code or open the invite link.
4. Wait for host approval.
5. Use shared files, chat, and patch proposals.

## Working Together

- Use `Shared File Tree` to inspect safe project files.
- Blocked files are hidden or marked blocked by path/secret policy.
- Use `Co-Op Chatbox` for human messages.
- Use `Jarvis-to-Jarvis Bridge` to ask both Jarvis systems for structured opinions.
- Use `Patch Court` to propose, ghost-test, approve, reject, and later apply changes.
- Use `Shared Task Board` to track work.
- Use `Replay Theater` to save the session timeline.

## Advanced Modes

- `Code Review Mode`: safe source viewing and patch suggestions.
- `Pair Build Mode`: future live edit mode after explicit host approval.
- `Ghost Sandbox Mode`: proposed changes are copied into an isolated runtime sandbox first.
- `Jarvis Debate Mode`: host and guest Jarvis systems submit evidence, risk, and recommendations.
- `Screen Co-Pilot Mode`: uses Device Mesh screen/control adapters; it is optional.
- `Skill Transfer Mode`: transfers safe skill manifests without secrets or private memory.

## Security

- Session codes expire after 10 minutes.
- Host approval is required for joins.
- Apply patch remains host controlled.
- Terminal access is off by default.
- Screen sharing/control is off by default and plugs into Device Mesh permission gates.
- `.env`, private keys, runtime secrets, raw private memory, `node_modules`, build output, and suspicious token-like content are blocked.
- Project memory packets are project-only by default.
- End the session when done.

## Troubleshooting

Connection fails:

- Use same Wi-Fi first.
- Check firewall prompts.
- Try a tailnet/VPN later if LAN is blocked.
- Relay/LiveKit/coturn are future optional transports, not required for the MVP.

Repo mismatch:

- Compare git commit, package hash, lockfile hash, module registry hash, and source hash.
- Stay in read-only/suggest mode until the mismatch is resolved.

Patch conflict:

- Reopen the file.
- Regenerate the patch.
- Run Ghost Sandbox again.
- Approve only after Patch Court shows the base hash still matches.

## Verification Commands

```powershell
npm run test:coop-symbiote
npm run test:backend
npm run test:feature
```
