"use strict";

const crypto = require("crypto");

function clip(value, max = 700) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function observationKey(snapshot = {}) {
  return crypto.createHash("sha256").update(JSON.stringify({
    url: snapshot.url || "",
    title: snapshot.title || "",
    text: clip(snapshot.pageText, 1_800),
    controls: (snapshot.elements || []).slice(0, 60).map((item) => [item.role, item.name, item.value, item.checked]),
  })).digest("hex").slice(0, 20);
}

class TaskWorldModel {
  constructor({ taskId, outcome, prior } = {}) {
    this.taskId = taskId;
    this.outcome = outcome;
    this.sequence = Number(prior?.sequence || 0);
    this.observations = Array.isArray(prior?.observations) ? prior.observations.slice(-20) : [];
    this.transitions = Array.isArray(prior?.transitions) ? prior.transitions.slice(-50) : [];
    this.checkpoints = Array.isArray(prior?.checkpoints) ? prior.checkpoints.slice(-12) : [];
    this.failures = Array.isArray(prior?.failures) ? prior.failures.slice(-20) : [];
    this.artifacts = Array.isArray(prior?.artifacts) ? prior.artifacts.slice(-30) : [];
    this.tabs = Array.isArray(prior?.tabs) ? prior.tabs.slice(-30) : [];
    this.criteria = (outcome?.successCriteria || []).map((item, index) => ({
      id: `criterion-${index + 1}`,
      ...item,
      satisfied: Boolean(prior?.criteria?.find((existing) => existing.id === `criterion-${index + 1}`)?.satisfied),
      evidence: prior?.criteria?.find((existing) => existing.id === `criterion-${index + 1}`)?.evidence || null,
    }));
    this.pending = null;
  }

  observe(snapshot, tabs = []) {
    this.sequence += 1;
    const observation = {
      sequence: this.sequence,
      key: observationKey(snapshot),
      url: snapshot.url || "",
      title: snapshot.title || "",
      text: clip(snapshot.pageText, 1_500),
      controlCount: snapshot.elements?.length || 0,
      at: new Date().toISOString(),
    };
    const previous = this.observations.at(-1);
    observation.changed = !previous || previous.key !== observation.key;
    this.observations.push(observation);
    this.observations = this.observations.slice(-20);
    this.tabs = tabs.map((tab) => ({ pageId: tab.pageId, taskId: tab.taskId || null, url: tab.url || "", title: tab.title || "" })).slice(-30);
    return observation;
  }

  plan(action) {
    this.pending = {
      sequence: this.sequence,
      action: action.action,
      target: action.ref || action.url || action.pageId || "",
      expected: clip(action.expected || "", 500),
      reason: clip(action.reason || "", 500),
      before: this.observations.at(-1)?.key || "",
      at: new Date().toISOString(),
    };
    return this.pending;
  }

  transition(action, result, afterObservation) {
    const before = this.pending || this.plan(action);
    const changed = Boolean(afterObservation?.changed);
    const transition = {
      ...before,
      ok: true,
      changed,
      after: afterObservation?.key || "",
      result: clip(typeof result === "string" ? result : JSON.stringify(result), 900),
      completedAt: new Date().toISOString(),
    };
    this.transitions.push(transition);
    this.transitions = this.transitions.slice(-50);
    if (changed || ["extract", "download", "upload"].includes(action.action)) {
      this.checkpoints.push({
        sequence: this.sequence,
        url: afterObservation?.url || this.observations.at(-1)?.url || "",
        action: action.action,
        evidence: transition.result,
        at: transition.completedAt,
      });
      this.checkpoints = this.checkpoints.slice(-12);
    }
    this.pending = null;
    return transition;
  }

  fail(action, error) {
    const failure = {
      sequence: this.sequence,
      action: action.action,
      target: action.ref || action.url || action.pageId || "",
      message: clip(error?.message || error, 700),
      observation: this.observations.at(-1)?.key || "",
      at: new Date().toISOString(),
    };
    this.failures.push(failure);
    this.failures = this.failures.slice(-20);
    this.pending = null;
    return failure;
  }

  addArtifact(artifact) {
    this.artifacts.push({ ...artifact, at: artifact.at || new Date().toISOString() });
    this.artifacts = this.artifacts.slice(-30);
  }

  satisfyCriterion(index, evidence) {
    const criterion = this.criteria[index];
    if (!criterion) return false;
    criterion.satisfied = true;
    criterion.evidence = evidence;
    return true;
  }

  repeatedState(limit = 4) {
    const recent = this.observations.slice(-limit);
    return recent.length >= limit && recent.every((item) => item.key === recent[0].key);
  }

  repeatedFailure(limit = 3) {
    const recent = this.failures.slice(-limit);
    return recent.length >= limit && recent.every((item) => item.action === recent[0].action && item.target === recent[0].target);
  }

  recoveryHint() {
    if (this.repeatedFailure(3)) return "Do not retry the same target. Search, scroll, inspect another tab, or choose a different route.";
    if (this.repeatedState(3)) return "The state is stalled. Use a different semantic control, scroll, wait once, go back, or switch tabs.";
    if (this.failures.at(-1)) return `The previous ${this.failures.at(-1).action} failed: ${this.failures.at(-1).message}. Treat it as an observation and choose an alternative.`;
    return "Continue toward the next unsatisfied success criterion.";
  }

  summary() {
    return {
      sequence: this.sequence,
      current: this.observations.at(-1) || null,
      recentTransitions: this.transitions.slice(-8),
      recentFailures: this.failures.slice(-5),
      checkpoints: this.checkpoints.slice(-5),
      artifacts: this.artifacts.slice(-8),
      criteria: this.criteria,
      recoveryHint: this.recoveryHint(),
    };
  }

  toJSON() {
    return {
      taskId: this.taskId,
      sequence: this.sequence,
      observations: this.observations,
      transitions: this.transitions,
      checkpoints: this.checkpoints,
      failures: this.failures,
      artifacts: this.artifacts,
      tabs: this.tabs,
      criteria: this.criteria,
    };
  }
}

module.exports = { TaskWorldModel, observationKey };
