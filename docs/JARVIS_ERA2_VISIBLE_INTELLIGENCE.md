# JARVIS Era II — Visible Intelligence

Era II connects the rich local brain to the current globe-room shell. It does not create another UI or another brain path.

## Unified turn protocol

`POST /api/chat/stream` remains NDJSON for compatibility and now emits ordered envelopes with `turnId`, `sequence`, and `timestamp`:

- `run`: accepted and completed state
- `plan`: selected intent and tools
- `model`: reasoning/synthesis rounds
- `tool`: start, verified completion, error, or approval state
- `source`, `artifact`, `approval`, `receipt`, and `ui`
- `delta`, `progress`, and final `done` remain supported

The current JARVIS response surface renders the recent activity timeline, sources, declarative cards, approval cards, artifact downloads, model/strength/token/cost/timing metadata, and an expandable technical trace.

## HUD tools

The capability engine now exposes `ui_open_widget`, `ui_focus_widget`, `ui_close_widget`, `ui_populate`, and `ui_render_card`. Widget ids are still validated by the frontend registry. Populate payloads carry an explicit truth state and never fabricate fallback records.

## Voice modes

The command-bar picker includes:

- Dictate: browser speech-to-text, free and local to the browser surface.
- Talk-Live: the existing Gemini Live controller, using a one-use server-issued token, two-way native audio, transcripts, tool results, and memory ingestion.

If Live is disabled or unconfigured, the current shell reports the real blocker.

## Attachments

The command bar accepts selection or drag-and-drop, up to five files and 8 MB combined. Text/code formats become bounded text context. Images, PDFs, and other Gemini-supported formats become inline multimodal parts. The files are sent only with the submitted turn; removing a chip removes that file from the submitted list.

## Downloadable artifacts

Work Composer outputs are served through the authenticated, artifact-scoped route:

`GET /api/artifacts/:artifactId/files/:name`

The route resolves only verified files under the Work Composer root. Results include media type, size, status, and `downloadUrl`. The response surface shows download chips and a dismissible download toast. Top-level generated images continue to use `/api/files/:name`.

## Verification contract

- Node syntax, TypeScript, and production build must pass.
- Era II contract tests exercise event envelopes, HUD capabilities, artifact downloads, and current-shell wiring.
- The complete backend suite must remain green.
- Final verification uses the restarted local backend and current in-app UI.
