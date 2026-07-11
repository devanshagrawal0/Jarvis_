# JARVIS Credentials Setup

Use this sheet as the single checklist for connecting providers.

Fill all provider values in:

```text
C:\Users\devan\.jarvis\JARVIS_CREDENTIALS.local.json
```

Then import everything with one command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\import-jarvis-credentials.ps1
```

The importer sends credentials to the local JARVIS server, stores secret
values in the Windows DPAPI-encrypted vault, and redacts the plaintext
worksheet after a successful import.

## Twilio Phone

Required now:

| Value | Where to find it | Example |
|---|---|---|
| Account SID | Twilio Console account dashboard | `AC...` |
| Auth Token | Twilio Console account dashboard | Hidden secret |
| JARVIS Twilio number | Phone Numbers > Active Numbers | `+1...` |
| Your personal number | The phone allowed to text JARVIS | `+1...` |
| Public webhook URL | Added after the cloud phone bridge is deployed | `https://...` |

Run the wizard and choose **Twilio Phone**.

## Gemini Brain

| Value | Required |
|---|---|
| Gemini API key | Yes |

## Google Workspace

| Value | Required |
|---|---|
| Google OAuth Client ID | Yes |
| Google OAuth Client Secret | Yes |
| Sender email | Optional |

After entering the OAuth application values, Google still requires one browser
login through JARVIS.

## Kalshi

| Value | Required |
|---|---|
| API Key ID | Yes |
| RSA private key | Yes |
| Environment | `production` or `demo` |

## Instagram Professional Messaging

| Value | Required |
|---|---|
| Meta/Instagram access token | Yes |
| Instagram professional account ID | Yes |

This API supports professional accounts. Personal Instagram browsing will use
the isolated JARVIS Playwright browser after you log in manually.

## Canvas

| Value | Required |
|---|---|
| Canvas base URL | Yes |
| Canvas access token | Yes |

## Optional Providers

The same wizard can also store:

- News API key
- GitHub token
- Higgsfield key
- Figma access token

## Verify Connections

Open JARVIS:

```text
http://127.0.0.1:8799
```

Then open **Connections**. A provider is only considered connected after its
health check succeeds.

## Security Rules

- Never send the Twilio Auth Token through text, email, screenshots, or chat.
- Never commit `runtime/`, `secrets.dpapi`, private keys, or credential exports.
- Keep `twilioAllowedCallers` restricted to your personal phone number.
- Rotate a credential immediately if it is accidentally exposed.
