// Memory Manager — structural maintenance for the neural vault.
// Handles: stale archival, working-memory pruning, procedural rule consolidation,
// orphaned relationship cleanup, entity dedup, and comprehensive health reporting.
//
// Complements memory-decay.js (which owns Ebbinghaus score updates) and
// maintenanceRun() in neural-vault.js (which does exact-string dedup only).
// This service goes much further and is the primary scheduled janitor.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Memories not accessed for longer than these thresholds AND below importance cutoff are archived.
const STALE_THRESHOLDS = {
  episode: { days: 90, importanceCutoff: 3 },
  semantic: { days: 120, importanceCutoff: 2 },
  fact: { days: 180, importanceCutoff: 2 },
  observation: { days: 45, importanceCutoff: 2 },
  default: { days: 120, importanceCutoff: 2 },
};

// Working memory (ms_working_memory) keys older than this are pruned if expired.
const WORKING_MEMORY_MAX_AGE_DAYS = 7;

// Maximum procedural rules per topic — older ones with lower importance are superseded.
const MAX_PROCEDURE_RULES_PER_TOPIC = 3;

// Health score thresholds
const HEALTH_WARN_ORPHAN_ENTITY_RATIO = 0.2; // >20% entities with no relationships = yellow
const HEALTH_WARN_LOW_CONFIDENCE_RATIO = 0.25; // >25% memories with confidence <0.4 = yellow
const HEALTH_WARN_STALE_RATIO = 0.3; // >30% memories are stale candidates = yellow

function isoNow() {
  return new Date().toISOString();
}

function daysSince(isoDate) {
  if (!isoDate) return 9999;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function createMemoryManager({ neuralVault, runtimeDir, intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  const reportsDir = path.join(runtimeDir, "neural_vault", "memory_manager_reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  let timer = null;
  let lastRunAt = null;
  let lastReport = null;

  // ─── STALE MEMORY ARCHIVAL ────────────────────────────────────────────────
  function archiveStaleMemories(db) {
    if (!tableExists(db, "memories")) return { archived: 0, candidates: 0 };
    const now = isoNow();
    const rows = db.prepare(`
      SELECT id, kind, importance, last_accessed_at, updated_at
      FROM memories
      WHERE status IS NULL OR status = 'active'
    `).all();

    let archived = 0;
    let candidates = 0;
    const archiveStmt = db.prepare("UPDATE memories SET status='archived', updated_at=? WHERE id=?");

    const doArchive = db.transaction(() => {
      for (const row of rows) {
        const threshold = STALE_THRESHOLDS[row.kind] || STALE_THRESHOLDS.default;
        const lastAccess = row.last_accessed_at || row.updated_at;
        const age = daysSince(lastAccess);
        const importance = Number(row.importance || 3);
        if (age >= threshold.days && importance < threshold.importanceCutoff) {
          candidates++;
          archiveStmt.run(now, row.id);
          archived++;
        }
      }
    });
    doArchive();
    return { archived, candidates };
  }

  // ─── WORKING MEMORY PRUNING ───────────────────────────────────────────────
  function pruneWorkingMemory(db) {
    if (!tableExists(db, "ms_working_memory")) return { pruned: 0, total: 0 };
    const now = isoNow();
    const total = db.prepare("SELECT COUNT(*) AS c FROM ms_working_memory").get()?.c || 0;

    // Delete expired entries (expires_at set and in the past)
    const expiredResult = db.prepare(`
      DELETE FROM ms_working_memory
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `).run(now);

    // Delete entries older than max age with no expiry
    const cutoff = new Date(Date.now() - WORKING_MEMORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oldResult = db.prepare(`
      DELETE FROM ms_working_memory
      WHERE expires_at IS NULL AND updated_at < ?
    `).run(cutoff);

    const pruned = (expiredResult.changes || 0) + (oldResult.changes || 0);
    return { pruned, total };
  }

  // ─── MS_MEMORIES STALE PRUNING ────────────────────────────────────────────
  function pruneStaleShortTermMemories(db) {
    if (!tableExists(db, "ms_memories")) return { pruned: 0 };
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare(`
      UPDATE ms_memories SET deleted_at=?, updated_at=?
      WHERE deleted_at IS NULL
        AND kind NOT IN ('procedural', 'procedure', 'correction')
        AND importance < 0.25
        AND updated_at < ?
    `).run(isoNow(), isoNow(), cutoff);
    return { pruned: result.changes || 0 };
  }

  // ─── PROCEDURAL RULE CONSOLIDATION ───────────────────────────────────────
  // Keep only the top MAX_PROCEDURE_RULES_PER_TOPIC per topic, supersede the rest.
  function consolidateProceduralRules(db) {
    if (!tableExists(db, "memories")) return { consolidated: 0, topics: 0 };
    const rules = db.prepare(`
      SELECT id, topic, importance, confidence, updated_at, content
      FROM memories
      WHERE kind IN ('procedure', 'correction')
        AND (status IS NULL OR status = 'active')
      ORDER BY topic, importance DESC, confidence DESC, updated_at DESC
    `).all();

    const byTopic = new Map();
    for (const rule of rules) {
      const topic = rule.topic || "_general";
      const group = byTopic.get(topic) || [];
      group.push(rule);
      byTopic.set(topic, group);
    }

    let consolidated = 0;
    const archiveStmt = db.prepare("UPDATE memories SET status='archived', updated_at=? WHERE id=?");
    const doConsolidate = db.transaction(() => {
      for (const [, group] of byTopic) {
        if (group.length <= MAX_PROCEDURE_RULES_PER_TOPIC) continue;
        // Keep the top N, archive the rest
        const toArchive = group.slice(MAX_PROCEDURE_RULES_PER_TOPIC);
        for (const rule of toArchive) {
          archiveStmt.run(isoNow(), rule.id);
          consolidated++;
        }
      }
    });
    doConsolidate();
    return { consolidated, topics: byTopic.size };
  }

  // ─── ORPHANED RELATIONSHIP CLEANUP ───────────────────────────────────────
  function cleanOrphanedRelationships(db) {
    if (!tableExists(db, "relationships") || !tableExists(db, "entities")) return { cleaned: 0 };
    const result = db.prepare(`
      UPDATE relationships SET status='inactive'
      WHERE status='active'
        AND (
          from_entity_id NOT IN (SELECT id FROM entities)
          OR to_entity_id NOT IN (SELECT id FROM entities)
        )
    `).run();
    return { cleaned: result.changes || 0 };
  }

  // ─── SELF-REFERENTIAL RELATIONSHIP CLEANUP ────────────────────────────────
  function cleanSelfRelationships(db) {
    if (!tableExists(db, "relationships")) return { cleaned: 0 };
    const result = db.prepare(`
      UPDATE relationships SET status='inactive'
      WHERE status='active' AND from_entity_id = to_entity_id
    `).run();
    return { cleaned: result.changes || 0 };
  }

  // ─── ENTITY DEDUP VIA NEURAL VAULT ───────────────────────────────────────
  // Uses neuralVault.mergeEntities when available — falls back to raw SQL otherwise.
  function deduplicateEntities(db) {
    if (!tableExists(db, "entities")) return { merged: 0 };
    // Find entities with identical normalized_name and type — keep the oldest (most referenced)
    const dups = db.prepare(`
      SELECT normalized_name, type, COUNT(*) AS cnt, GROUP_CONCAT(id ORDER BY created_at ASC) AS ids
      FROM entities
      GROUP BY normalized_name, type
      HAVING cnt > 1
    `).all();

    let merged = 0;
    for (const dup of dups) {
      const ids = String(dup.ids).split(",").filter(Boolean);
      if (ids.length < 2) continue;
      const primaryId = ids[0];
      for (const duplicateId of ids.slice(1)) {
        try {
          if (neuralVault?.mergeEntities) {
            neuralVault.mergeEntities(primaryId, duplicateId);
          } else {
            // Fallback raw SQL merge
            db.prepare("UPDATE OR IGNORE memory_entities SET entity_id=? WHERE entity_id=?").run(primaryId, duplicateId);
            db.prepare("DELETE FROM memory_entities WHERE entity_id=?").run(duplicateId);
            db.prepare("UPDATE relationships SET from_entity_id=? WHERE from_entity_id=?").run(primaryId, duplicateId);
            db.prepare("UPDATE relationships SET to_entity_id=? WHERE to_entity_id=?").run(primaryId, duplicateId);
            db.prepare("DELETE FROM entities WHERE id=?").run(duplicateId);
          }
          merged++;
        } catch {
          // Skip if merge fails (entity may already be gone)
        }
      }
    }
    return { merged };
  }

  // ─── HEALTH METRICS ───────────────────────────────────────────────────────
  function collectHealthMetrics(db) {
    const metrics = {
      memories: {},
      shortTermMemories: {},
      entities: {},
      relationships: {},
      workingMemory: {},
      procedures: {},
      vault: {},
    };

    // Long-term memories (neural vault)
    if (tableExists(db, "memories")) {
      const counts = db.prepare(`
        SELECT kind, COUNT(*) AS cnt, AVG(importance) AS avg_imp, AVG(confidence) AS avg_conf
        FROM memories WHERE status IS NULL OR status = 'active'
        GROUP BY kind
      `).all();
      metrics.memories.byKind = Object.fromEntries(counts.map((r) => [r.kind, { count: r.cnt, avgImportance: Math.round((r.avg_imp || 0) * 10) / 10, avgConfidence: Math.round((r.avg_conf || 1) * 100) / 100 }]));
      metrics.memories.total = counts.reduce((s, r) => s + r.cnt, 0);
      metrics.memories.lowConfidence = db.prepare("SELECT COUNT(*) AS c FROM memories WHERE (status IS NULL OR status='active') AND confidence < 0.4").get()?.c || 0;
      metrics.memories.archived = db.prepare("SELECT COUNT(*) AS c FROM memories WHERE status='archived'").get()?.c || 0;
    }

    // Short-term memories (memory-store ms_ tables)
    if (tableExists(db, "ms_memories")) {
      metrics.shortTermMemories.active = db.prepare("SELECT COUNT(*) AS c FROM ms_memories WHERE deleted_at IS NULL").get()?.c || 0;
      metrics.shortTermMemories.deleted = db.prepare("SELECT COUNT(*) AS c FROM ms_memories WHERE deleted_at IS NOT NULL").get()?.c || 0;
    }

    // Entities
    if (tableExists(db, "entities")) {
      metrics.entities.total = db.prepare("SELECT COUNT(*) AS c FROM entities").get()?.c || 0;
      // Entities with no relationships (orphans)
      const withRel = tableExists(db, "relationships")
        ? db.prepare("SELECT COUNT(DISTINCT from_entity_id) AS c FROM relationships WHERE status='active'").get()?.c || 0
        : 0;
      metrics.entities.withRelationships = withRel;
      metrics.entities.orphans = Math.max(0, metrics.entities.total - withRel);
    }

    // Relationships
    if (tableExists(db, "relationships")) {
      metrics.relationships.active = db.prepare("SELECT COUNT(*) AS c FROM relationships WHERE status='active'").get()?.c || 0;
      metrics.relationships.inactive = db.prepare("SELECT COUNT(*) AS c FROM relationships WHERE status='inactive'").get()?.c || 0;
    }

    // Working memory
    if (tableExists(db, "ms_working_memory")) {
      metrics.workingMemory.total = db.prepare("SELECT COUNT(*) AS c FROM ms_working_memory").get()?.c || 0;
      const now = isoNow();
      metrics.workingMemory.expired = db.prepare("SELECT COUNT(*) AS c FROM ms_working_memory WHERE expires_at IS NOT NULL AND expires_at < ?").get(now)?.c || 0;
    }

    // Procedural rules
    if (tableExists(db, "memories")) {
      metrics.procedures.active = db.prepare("SELECT COUNT(*) AS c FROM memories WHERE kind IN ('procedure','correction') AND (status IS NULL OR status='active')").get()?.c || 0;
    }
    if (tableExists(db, "ms_memories")) {
      metrics.procedures.shortTerm = db.prepare("SELECT COUNT(*) AS c FROM ms_memories WHERE kind='procedural' AND deleted_at IS NULL").get()?.c || 0;
    }

    // Vault DB size
    try {
      const stat = fs.statSync(dbPath);
      metrics.vault.dbSizeBytes = stat.size;
      metrics.vault.dbSizeMB = Math.round((stat.size / (1024 * 1024)) * 10) / 10;
    } catch {
      metrics.vault.dbSizeBytes = 0;
      metrics.vault.dbSizeMB = 0;
    }

    return metrics;
  }

  // ─── HEALTH SCORE CALCULATION ─────────────────────────────────────────────
  function computeHealthScore(metrics, actions) {
    let score = 100;
    const flags = [];

    const total = metrics.memories.total || 0;
    const entities = metrics.entities.total || 0;

    if (total > 0) {
      const lowConfRatio = (metrics.memories.lowConfidence || 0) / total;
      if (lowConfRatio > HEALTH_WARN_LOW_CONFIDENCE_RATIO) {
        score -= Math.min(20, Math.round(lowConfRatio * 40));
        flags.push(`High low-confidence memory ratio: ${Math.round(lowConfRatio * 100)}%`);
      }
    }

    if (entities > 0) {
      const orphanRatio = (metrics.entities.orphans || 0) / entities;
      if (orphanRatio > HEALTH_WARN_ORPHAN_ENTITY_RATIO) {
        score -= Math.min(15, Math.round(orphanRatio * 25));
        flags.push(`High orphan entity ratio: ${Math.round(orphanRatio * 100)}%`);
      }
    }

    if ((metrics.workingMemory.expired || 0) > 20) {
      score -= 5;
      flags.push(`Working memory has ${metrics.workingMemory.expired} expired entries`);
    }

    if ((metrics.procedures.active || 0) > 20) {
      score -= 5;
      flags.push(`Too many procedural rules active: ${metrics.procedures.active}`);
    }

    if ((metrics.vault.dbSizeMB || 0) > 500) {
      score -= 10;
      flags.push(`DB size is large: ${metrics.vault.dbSizeMB}MB`);
    }

    // Reward for clean maintenance
    if (actions.archiveStale === 0 && actions.pruneWorking === 0 && actions.cleanOrphans === 0) {
      score = Math.min(100, score + 3);
      flags.push("Vault is clean — no maintenance needed");
    }

    return { score: Math.max(0, Math.min(100, score)), flags };
  }

  // ─── MAIN RUN ────────────────────────────────────────────────────────────
  function run({ source = "manual" } = {}) {
    const startedAt = isoNow();
    let db;
    try {
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");

      // Run all maintenance operations
      const staleResult = archiveStaleMemories(db);
      const workingResult = pruneWorkingMemory(db);
      const shortTermResult = pruneStaleShortTermMemories(db);
      const proceduralResult = consolidateProceduralRules(db);
      const orphanRelResult = cleanOrphanedRelationships(db);
      const selfRelResult = cleanSelfRelationships(db);
      const entityDedupResult = deduplicateEntities(db);

      const actions = {
        archiveStale: staleResult.archived,
        pruneWorking: workingResult.pruned,
        pruneShortTerm: shortTermResult.pruned,
        consolidateProcedures: proceduralResult.consolidated,
        cleanOrphans: orphanRelResult.cleaned,
        cleanSelfRels: selfRelResult.cleaned,
        mergeEntities: entityDedupResult.merged,
      };

      // Collect health metrics AFTER cleanup
      const metrics = collectHealthMetrics(db);
      const { score, flags } = computeHealthScore(metrics, actions);

      const endedAt = isoNow();
      const durationMs = new Date(endedAt) - new Date(startedAt);

      const report = {
        runId: require("crypto").randomUUID(),
        startedAt,
        endedAt,
        durationMs,
        source,
        actions,
        metrics,
        health: { score, flags, grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F" },
      };

      lastRunAt = endedAt;
      lastReport = report;

      // Write markdown report
      writeMarkdownReport(report);

      return { ok: true, report };
    } catch (err) {
      const report = { ok: false, error: err.message, startedAt, endedAt: isoNow(), source };
      lastReport = report;
      return { ok: false, error: err.message, report };
    } finally {
      try { db?.close(); } catch {}
    }
  }

  // ─── MARKDOWN REPORT ─────────────────────────────────────────────────────
  function writeMarkdownReport(report) {
    const { health, metrics, actions } = report;
    const m = metrics.memories || {};
    const e = metrics.entities || {};
    const r = metrics.relationships || {};
    const w = metrics.workingMemory || {};
    const p = metrics.procedures || {};

    const kindTable = Object.entries(m.byKind || {})
      .map(([kind, s]) => `| ${kind} | ${s.count} | ${s.avgImportance} | ${s.avgConfidence} |`)
      .join("\n");

    const md = [
      `# Jarvis Memory Manager Report`,
      `**Run:** ${report.startedAt}  |  **Duration:** ${report.durationMs}ms  |  **Source:** ${report.source}`,
      `**Health Score:** ${health.score}/100 (Grade: ${health.grade})`,
      ``,
      `## Health Flags`,
      health.flags.length ? health.flags.map((f) => `- ${f}`).join("\n") : "- No issues detected",
      ``,
      `## Actions Taken`,
      `| Action | Count |`,
      `|---|---|`,
      `| Stale memories archived | ${actions.archiveStale} |`,
      `| Working memory entries pruned | ${actions.pruneWorking} |`,
      `| Short-term memories pruned | ${actions.pruneShortTerm} |`,
      `| Procedural rules consolidated | ${actions.consolidateProcedures} |`,
      `| Orphaned relationships cleaned | ${actions.cleanOrphans} |`,
      `| Self-referential relationships cleaned | ${actions.cleanSelfRels} |`,
      `| Duplicate entities merged | ${actions.mergeEntities} |`,
      ``,
      `## Memory Metrics`,
      `**Total active:** ${m.total || 0}  |  **Archived:** ${m.archived || 0}  |  **Low confidence:** ${m.lowConfidence || 0}`,
      ``,
      `| Kind | Count | Avg Importance | Avg Confidence |`,
      `|---|---|---|---|`,
      kindTable || "| (no data) | — | — | — |",
      ``,
      `## Entity & Relationship Metrics`,
      `- Total entities: ${e.total || 0}`,
      `- Entities with relationships: ${e.withRelationships || 0}`,
      `- Orphan entities: ${e.orphans || 0}`,
      `- Active relationships: ${r.active || 0}`,
      `- Inactive relationships: ${r.inactive || 0}`,
      ``,
      `## Working Memory`,
      `- Total entries: ${w.total || 0}`,
      `- Expired entries: ${w.expired || 0}`,
      ``,
      `## Procedural Rules`,
      `- Active long-term rules: ${p.active || 0}`,
      `- Active short-term rules: ${p.shortTerm || 0}`,
      ``,
      `## Vault`,
      `- DB size: ${metrics.vault?.dbSizeMB || 0} MB`,
    ].join("\n");

    const filename = `${report.startedAt.replace(/[:.]/g, "-")}.md`;
    try {
      fs.writeFileSync(path.join(reportsDir, filename), md, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Non-fatal — report is still returned from run()
    }
    return md;
  }

  // ─── STATUS & SCHEDULING ─────────────────────────────────────────────────
  function status() {
    return {
      lastRunAt,
      lastReport: lastReport ? {
        ok: lastReport.ok,
        health: lastReport.health,
        actions: lastReport.actions,
        durationMs: lastReport.durationMs,
        startedAt: lastReport.startedAt,
      } : null,
      intervalMs,
      scheduled: Boolean(timer),
    };
  }

  function listReports({ limit = 10 } = {}) {
    try {
      const files = fs.readdirSync(reportsDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, limit);
      return files.map((f) => ({
        filename: f,
        path: path.join(reportsDir, f),
        timestamp: f.replace(/\.md$/, "").replace(/-(\d{3})$/, ".$1"),
      }));
    } catch {
      return [];
    }
  }

  function readReport(filename) {
    try {
      return fs.readFileSync(path.join(reportsDir, filename), "utf8");
    } catch {
      return null;
    }
  }

  function start() {
    // Run once on startup after a short delay so the DB is fully settled
    const startupTimer = setTimeout(() => run({ source: "startup" }), 45_000);
    startupTimer.unref?.();
    timer = setInterval(() => run({ source: "interval" }), intervalMs);
    timer.unref?.();
    return { started: true, intervalMs };
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    return { stopped: true };
  }

  return { run, start, stop, status, listReports, readReport };
}

module.exports = { createMemoryManager };
