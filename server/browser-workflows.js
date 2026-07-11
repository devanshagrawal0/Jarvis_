// Browser Workflow store — Tier 1 fast path for browser automation.
// When a user command matches a saved workflow, the pre-recorded steps
// are injected into the brain context so Gemini reuses them instead of
// re-deriving the automation sequence from scratch.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORE_FILE = path.join(__dirname, "..", "runtime", "browser_workflows.json");

function loadWorkflows() {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWorkflows(workflows) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(workflows, null, 2), "utf8");
}

function saveWorkflow(workflow) {
  const now = new Date().toISOString();
  const id = workflow.id || crypto.randomUUID();
  const existing = loadWorkflows();
  const item = {
    id,
    name: String(workflow.name || "").trim(),
    description: String(workflow.description || "").trim(),
    // trigger_phrases: keywords that activate this workflow
    triggerPhrases: Array.isArray(workflow.triggerPhrases) ? workflow.triggerPhrases : [],
    // steps: ordered array of {action, selector, value, url} objects
    steps: Array.isArray(workflow.steps) ? workflow.steps : [],
    // target_url pattern (optional) — e.g. "youtube.com"
    targetUrl: workflow.targetUrl || "",
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const updated = [item, ...existing.filter((w) => w.id !== id)];
  saveWorkflows(updated);
  return item;
}

function deleteWorkflow(id) {
  const existing = loadWorkflows();
  const updated = existing.filter((w) => w.id !== id);
  if (updated.length === existing.length) return false;
  saveWorkflows(updated);
  return true;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Returns the best-matching workflow for the given prompt, or null.
// Scoring: each trigger phrase word that appears in the prompt adds 1 point.
// A workflow is only returned if it scores >= 2 OR has an exact phrase match.
function matchWorkflow(prompt) {
  const workflows = loadWorkflows();
  if (!workflows.length) return null;
  const promptTokens = new Set(tokenize(prompt));
  const promptLower = String(prompt || "").toLowerCase();
  let best = null;
  let bestScore = 1; // minimum score threshold

  for (const workflow of workflows) {
    let score = 0;
    for (const phrase of workflow.triggerPhrases || []) {
      const phraseLower = String(phrase).toLowerCase();
      // Exact phrase match → high score
      if (promptLower.includes(phraseLower)) {
        score += 5;
        continue;
      }
      // Token overlap
      const phraseTokens = tokenize(phrase);
      const overlap = phraseTokens.filter((t) => promptTokens.has(t)).length;
      score += overlap;
    }
    if (score > bestScore) {
      bestScore = score;
      best = workflow;
    }
  }
  if (best) {
    // Increment usage count
    try {
      const all = loadWorkflows();
      const idx = all.findIndex((w) => w.id === best.id);
      if (idx !== -1) {
        all[idx].usageCount = (all[idx].usageCount || 0) + 1;
        all[idx].lastUsedAt = new Date().toISOString();
        saveWorkflows(all);
      }
    } catch {}
  }
  return best;
}

// Format matched workflow for injection into Gemini system context
function workflowToContextHint(workflow) {
  if (!workflow) return "";
  const steps = (workflow.steps || [])
    .map((s, i) => `  ${i + 1}. ${s.action}${s.url ? " → " + s.url : ""}${s.selector ? " [" + s.selector + "]" : ""}${s.value ? " = " + s.value : ""}`)
    .join("\n");
  return `[Saved browser workflow: "${workflow.name}"]\nSteps:\n${steps || "  (no steps recorded)"}\nUse these steps directly rather than re-deriving the automation sequence.`;
}

module.exports = {
  loadWorkflows,
  saveWorkflow,
  deleteWorkflow,
  matchWorkflow,
  workflowToContextHint,
};
