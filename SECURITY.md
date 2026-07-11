# Security Policy

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue.** Instead, report it privately via [GitHub Security Advisories](https://github.com/devanshagrawal0/Jarvis_/security/advisories/new) (Security → Report a vulnerability), or contact the maintainer directly.

Please include:
- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- affected version / commit.

I'll acknowledge as soon as I can and work on a fix.

## Handling secrets

Jarvis Command OS is **local-first** and stores everything under `runtime/` on your machine. Some notes if you fork or deploy it:

- **All API keys are read from `process.env`** — none are hardcoded. Never commit real keys.
- `.env`, `runtime/`, `*.dpapi`, `*.pem`, `*.key`, and credential JSON are git-ignored. Verify with `git status` before pushing.
- If a key is ever exposed, **rotate it immediately** at the provider.
- The device mesh uses 256-bit pairing; set `JARVIS_BROKER_TOKEN` to secure the mesh broker if you expose it beyond localhost.

## Scope

This is a personal research project provided "as is" (see [LICENSE](LICENSE)). THE FORGE and APEX are not financial advice.
