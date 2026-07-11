# Contributing to Jarvis Command OS

Thanks for your interest! This is primarily a personal research project, but issues, ideas, and PRs are welcome.

## Getting set up

```bash
npm install
cp .env.example .env      # fill in whichever keys you have (none are required to boot)
npm start                 # backend  → http://127.0.0.1:8799
npm run dev               # frontend → http://127.0.0.1:5173
```

See the [README](README.md#-quick-start) for the full quick-start, and [`docs/`](docs/) for architecture deep-dives.

## Before you open a PR

- **Run the checks:** `npm run check` (typecheck + `node --check server.js` + build). Keep the build green.
- **Match the surrounding code.** CommonJS in `server/**`, TypeScript/React in `src/**`. Follow existing naming, structure, and comment density.
- **Never commit secrets.** `.env`, `runtime/`, credential JSON, and `*.dpapi` blobs are git-ignored — keep it that way. All keys must be read from `process.env`.
- **Don't commit heavy binaries** (`*.mp4`, `*.glb`, large textures) — they're git-ignored on purpose (see README → Heavy assets).
- **Keep PRs focused.** One logical change per PR, with a clear description of what and why.

## Reporting bugs & requesting features

Use the issue templates (Bug report / Feature request). Include steps to reproduce, expected vs. actual behavior, and your OS + Node version for bugs.

## Scope note

THE FORGE and APEX are research/education tools, not trading advice. Contributions that add data sources should use **public** APIs only, so the app stays shareable.
