// Synapse (Co-Op) W8 — Session Intelligence: a deterministic recap (decisions + open threads +
// key events), export (Markdown / JSON), and per-session metrics. No model needed — everything is
// derived from the durable timeline/chat/patches, so it works offline and is fully verifiable.

// Decisions worth logging, mapped from timeline event types → human phrasing.
const DECISION_EVENTS = {
  session_created: "Session created",
  join_approved: "Guest approved",
  join_denied: "Join request denied",
  patch_approved: "Patch approved",
  patch_rejected: "Patch rejected",
  patch_applied: "Patch applied to host disk",
  jarvis_debate: "Jarvis debate resolved",
  skill_transfer_offered: "Skill offered",
  memory_packet_created: "Memory packet shared",
  session_ended: "Session ended",
};

function decisionLog(session) {
  return (session.timeline || [])
    .filter((e) => DECISION_EVENTS[e.eventType])
    .map((e) => ({ at: e.timestamp, actor: e.actor, decision: DECISION_EVENTS[e.eventType], detail: e.payload?.summary || e.payload?.filePath || e.payload?.peerName || e.payload?.recommendation || "" }))
    .slice(0, 100);
}

function durationMs(session) {
  const start = Date.parse(session.createdAt || "") || 0;
  const end = session.endedAt ? Date.parse(session.endedAt) : Date.now();
  return start ? Math.max(0, end - start) : 0;
}

function sessionMetrics(session) {
  const patches = session.patches || [];
  return {
    messages: (session.chat || []).length,
    bridgeMessages: (session.jarvisMessages || []).length,
    tasks: (session.tasks || []).length,
    tasksDone: (session.tasks || []).filter((t) => /done/i.test(t.status || "")).length,
    patches: patches.length,
    patchesApplied: patches.filter((p) => p.status === "applied").length,
    patchesBlocked: patches.filter((p) => p.review?.verdict === "block").length,
    replays: (session.replays || []).length,
    events: (session.timeline || []).length,
    durationMs: durationMs(session),
    transportMode: session.transport?.mode || "unknown",
    safetyVerified: !!session.guest?.safetyNumber,
    repoMatch: session.repoMatch || "unknown",
  };
}

function buildRecap(session) {
  const decisions = decisionLog(session);
  const patches = session.patches || [];
  const openPatches = patches.filter((p) => !["applied", "rejected"].includes(p.status));
  const openTasks = (session.tasks || []).filter((t) => !/done/i.test(t.status || ""));
  const m = sessionMetrics(session);
  const mins = Math.round(m.durationMs / 60000);
  return {
    title: session.title || "Synapse session",
    mode: session.mode,
    peer: session.peerName || "solo",
    durationMinutes: mins,
    metrics: m,
    decisions,
    openThreads: [
      ...openPatches.map((p) => `Patch pending: ${p.summary || p.filePath} (${p.status})`),
      ...openTasks.map((t) => `Task open: ${t.title}`),
    ].slice(0, 40),
    summary: `${session.title || "Session"} (${session.mode || "co-op"}) with ${session.peerName || "no peer"} — ${mins} min · ${m.patchesApplied}/${m.patches} patches applied · ${m.messages} messages · ${decisions.length} logged decisions.`,
  };
}

function toMarkdown(session) {
  const r = buildRecap(session);
  const L = [];
  L.push(`# ${r.title} — session recap`);
  L.push("");
  L.push(`- **Mode:** ${r.mode}`);
  L.push(`- **Peer:** ${r.peer}`);
  L.push(`- **Duration:** ${r.durationMinutes} min`);
  L.push(`- **Repo match:** ${r.metrics.repoMatch} · **Safety verified:** ${r.metrics.safetyVerified ? "yes" : "no"}`);
  L.push("");
  L.push(`> ${r.summary}`);
  L.push("");
  L.push(`## Decisions (${r.decisions.length})`);
  for (const d of r.decisions) L.push(`- **${d.decision}**${d.detail ? ` — ${d.detail}` : ""} _(by ${d.actor || "?"})_`);
  L.push("");
  L.push(`## Patches (${(session.patches || []).length})`);
  for (const p of session.patches || []) L.push(`- \`${p.filePath}\` — ${p.summary || ""} · **${p.status}**${p.review ? ` · review: ${p.review.verdict}` : ""}`);
  L.push("");
  if (r.openThreads.length) { L.push(`## Open threads`); for (const t of r.openThreads) L.push(`- ${t}`); L.push(""); }
  L.push(`## Transcript (${(session.chat || []).length})`);
  for (const c of [...(session.chat || [])].reverse().slice(0, 200)) L.push(`- **${c.senderName || c.senderType}:** ${c.text}`);
  L.push("");
  return L.join("\n");
}

function exportSession(session, format = "json") {
  if (format === "md" || format === "markdown") return { format: "markdown", content: toMarkdown(session), filename: `synapse-${session.id}.md` };
  const json = {
    id: session.id, title: session.title, mode: session.mode, peer: session.peerName,
    createdAt: session.createdAt, endedAt: session.endedAt,
    recap: buildRecap(session),
    chat: session.chat || [], patches: (session.patches || []).map((p) => ({ filePath: p.filePath, summary: p.summary, status: p.status, review: p.review?.verdict })),
    tasks: session.tasks || [], timeline: session.timeline || [],
  };
  return { format: "json", content: JSON.stringify(json, null, 2), filename: `synapse-${session.id}.json` };
}

module.exports = { decisionLog, sessionMetrics, buildRecap, exportSession };
