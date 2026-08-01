# ADR-008: Durable Task and Side-Effect Truth

- Status: Accepted for Wave 9
- Date: 2026-07-24

Tasks are ordered dependency graphs, not chat-formatted plans. Task, step, approval, agent, artifact, checkpoint, and tool state live in typed rows. Significant transitions enter a bounded cognitive event stream; debug telemetry does not.

Every tool operation has a stable idempotency key and keyed argument hash. A completed side effect owns an encrypted receipt and can only replay that receipt. External and irreversible operations require a live approval. Checkpoints encrypt exact execution state and store only a keyed resume-token hash. Conversation state receives a compact active-task projection when a finalized source turn exists.

