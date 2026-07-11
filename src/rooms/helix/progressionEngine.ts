// Pure functions — no side effects, no fetches.

export const PROGRESSIONS: Record<string, string[]> = {
  market:     ["captured", "analyzed", "challenged", "sized", "ordered"],
  code:       ["captured", "reviewed", "written", "tested"],
  decision:   ["captured", "options-out", "challenged", "locked"],
  data:       ["captured", "loaded", "modeled", "validated", "locked"],
  comparison: ["captured", "compared", "weighted", "decided"],
  research:   ["captured", "triangulated", "prior-art", "locked"],
  people:     ["captured", "profiled", "connected", "locked"],
  media:      ["captured", "analyzed", "cited", "locked"],
  design:     ["captured", "mapped", "reviewed", "locked"],
  generic:    ["captured", "analyzed", "locked"],
};

// Maps action name → stage label it completes, per tab type
const ACTION_STAGE_MAP: Record<string, Record<string, string>> = {
  market: {
    triangulate: "analyzed",
    redteam:     "challenged",
    develop:     "sized",
    lock:        "ordered",
  },
  code: {
    triangulate: "reviewed",
    develop:     "written",
    redteam:     "tested",
    lock:        "tested",
  },
  decision: {
    develop:        "options-out",
    redteam:        "challenged",
    lock:           "locked",
  },
  data: {
    triangulate: "loaded",
    develop:     "modeled",
    redteam:     "validated",
    lock:        "locked",
  },
  comparison: {
    triangulate: "compared",
    develop:     "weighted",
    lock:        "decided",
  },
  research: {
    triangulate: "triangulated",
    "prior-art": "prior-art",
    lock:        "locked",
  },
  people: {
    triangulate: "profiled",
    probe:       "connected",
    lock:        "locked",
  },
  media: {
    triangulate: "analyzed",
    develop:     "cited",
    lock:        "locked",
  },
  design: {
    triangulate: "mapped",
    redteam:     "reviewed",
    lock:        "locked",
  },
  generic: {
    triangulate: "analyzed",
    lock:        "locked",
  },
};

// Returns the furthest stage the entry has reached based on completed actions (R11 — pure function)
export function computeProgressionStage(tabType: string, completedActions: string[]): string {
  const stages = PROGRESSIONS[tabType] ?? PROGRESSIONS.generic;
  const map = ACTION_STAGE_MAP[tabType] ?? ACTION_STAGE_MAP.generic;
  let highest = 0;
  for (const action of completedActions) {
    const stage = map[action];
    if (stage) {
      const idx = stages.indexOf(stage);
      if (idx > highest) highest = idx;
    }
  }
  return stages[highest];
}

export function isTerminalStage(tabType: string, stage: string): boolean {
  const stages = PROGRESSIONS[tabType] ?? PROGRESSIONS.generic;
  return stage === stages[stages.length - 1];
}

export interface NextAction {
  label: string;
  action: string;
  description: string;
}

const NEXT_ACTION_DEFS: Record<string, Record<string, NextAction>> = {
  market: {
    captured:   { label: "Triangulate", action: "triangulate", description: "Validate the thesis from 3 angles" },
    analyzed:   { label: "Red Team",    action: "redteam",     description: "Challenge the signal with 5 adversaries" },
    challenged: { label: "Develop",     action: "develop",     description: "Generate position sizing strategies" },
    sized:      { label: "Lock",        action: "lock",        description: "Commit the trade to the vault" },
  },
  code: {
    captured: { label: "Triangulate", action: "triangulate", description: "Code review from 3 angles" },
    reviewed: { label: "Develop",     action: "develop",     description: "Generate improved implementation" },
    written:  { label: "Red Team",    action: "redteam",     description: "Adversarial testing & edge cases" },
  },
  decision: {
    captured:      { label: "Develop Options", action: "develop",  description: "Generate 3 distinct option paths" },
    "options-out": { label: "Red Team",        action: "redteam",  description: "Challenge every assumption" },
    challenged:    { label: "Lock Decision",   action: "lock",     description: "Commit to the chosen path" },
  },
  data: {
    captured:  { label: "Triangulate", action: "triangulate", description: "Load and cross-validate the dataset" },
    loaded:    { label: "Develop",     action: "develop",     description: "Build model and extract insights" },
    modeled:   { label: "Red Team",    action: "redteam",     description: "Stress-test model assumptions" },
    validated: { label: "Lock",        action: "lock",        description: "Archive the validated dataset" },
  },
  comparison: {
    captured: { label: "Triangulate", action: "triangulate", description: "Compare attributes head-to-head" },
    compared: { label: "Develop",     action: "develop",     description: "Weight criteria and score options" },
    weighted: { label: "Lock",        action: "lock",        description: "Finalize the comparison verdict" },
  },
  research: {
    captured:     { label: "Triangulate",  action: "triangulate", description: "Cross-validate sources from 3 angles" },
    triangulated: { label: "Scan Prior Art", action: "prior-art", description: "Find existing work and gaps" },
    "prior-art":  { label: "Lock",         action: "lock",        description: "Archive research findings" },
  },
  people: {
    captured:  { label: "Triangulate", action: "triangulate", description: "Validate profile from multiple sources" },
    profiled:  { label: "Probe",       action: "probe",       description: "Map connections and relationships" },
    connected: { label: "Lock",        action: "lock",        description: "Commit profile to intelligence vault" },
  },
  media: {
    captured:  { label: "Triangulate", action: "triangulate", description: "Analyze content from 3 angles" },
    analyzed:  { label: "Develop",     action: "develop",     description: "Extract key citations and arguments" },
    cited:     { label: "Lock",        action: "lock",        description: "Archive media intelligence" },
  },
  design: {
    captured: { label: "Triangulate", action: "triangulate", description: "Map architecture from 3 perspectives" },
    mapped:   { label: "Red Team",    action: "redteam",     description: "Challenge design decisions" },
    reviewed: { label: "Lock",        action: "lock",        description: "Commit design to vault" },
  },
  generic: {
    captured: { label: "Triangulate", action: "triangulate", description: "Validate the claim from 3 angles" },
    analyzed: { label: "Lock",        action: "lock",        description: "Commit findings to vault" },
  },
};

export function getNextAction(tabType: string, currentStage: string): NextAction | null {
  const defs = NEXT_ACTION_DEFS[tabType] ?? NEXT_ACTION_DEFS.generic;
  return defs[currentStage] ?? null;
}

export function getStageIndex(tabType: string, stage: string): number {
  const stages = PROGRESSIONS[tabType] ?? PROGRESSIONS.generic;
  const idx = stages.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

export function getStageCount(tabType: string): number {
  return (PROGRESSIONS[tabType] ?? PROGRESSIONS.generic).length;
}
