const LEVELS = Object.freeze({
  observe: 0,
  prepare: 1,
  act: 2,
  autopilot: 3,
});

const DEFAULT_PROFILE = Object.freeze({
  level: "act",
  allowedTools: [],
  deniedTools: [],
  allowedApps: [],
  allowedDomains: [],
  maxActionsPerMinute: 30,
  autopilotExpiresAt: "",
});

function normalizeLevel(level) {
  const value = String(level || "").toLowerCase();
  return Object.hasOwn(LEVELS, value) ? value : DEFAULT_PROFILE.level;
}

function requiredLevel(definition) {
  if (definition.risk === "observe") return "observe";
  if (definition.risk === "prepare") return "prepare";
  return "act";
}

function normalizeProfile(profile = {}) {
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    level: normalizeLevel(profile.level),
    allowedTools: Array.isArray(profile.allowedTools) ? profile.allowedTools.map(String) : [],
    deniedTools: Array.isArray(profile.deniedTools) ? profile.deniedTools.map(String) : [],
    allowedApps: Array.isArray(profile.allowedApps) ? profile.allowedApps.map((value) => String(value).toLowerCase()) : [],
    allowedDomains: Array.isArray(profile.allowedDomains) ? profile.allowedDomains.map((value) => String(value).toLowerCase()) : [],
    maxActionsPerMinute: Math.max(1, Math.min(120, Number(profile.maxActionsPerMinute || 30))),
    autopilotExpiresAt: String(profile.autopilotExpiresAt || ""),
  };
}

function evaluateAutonomy({ definition, tool, args, profile, context, recentActionCount = 0 }) {
  const normalized = normalizeProfile(profile);
  const required = requiredLevel(definition);
  const autopilotExpired = normalized.level === "autopilot"
    && (!normalized.autopilotExpiresAt || new Date(normalized.autopilotExpiresAt).getTime() <= Date.now());
  const effectiveLevel = autopilotExpired ? "act" : normalized.level;

  if (normalized.deniedTools.includes(tool)) {
    return { allowed: false, reason: `${tool} is denied by the autonomy profile`, profile: normalized, required };
  }
  if (normalized.allowedTools.length && !normalized.allowedTools.includes(tool)) {
    return { allowed: false, reason: `${tool} is outside the autonomy tool allowlist`, profile: normalized, required };
  }
  if (required !== "observe" && recentActionCount >= normalized.maxActionsPerMinute) {
    return { allowed: false, reason: "Autonomy action rate limit reached", profile: normalized, required };
  }
  if (context.source === "voice" && definition.risk === "commit") {
    return { allowed: false, reason: "Voice sessions may prepare but cannot commit external side effects", profile: normalized, required };
  }
  if (tool === "open_app" || tool === "close_app") {
    const app = String(args.app || "").toLowerCase();
    if (normalized.allowedApps.length && !normalized.allowedApps.includes(app)) {
      return { allowed: false, reason: `${app} is outside the application allowlist`, profile: normalized, required };
    }
  }
  if (LEVELS[effectiveLevel] < LEVELS[required]) {
    return {
      allowed: false,
      needsElevation: true,
      reason: `${tool} requires ${required} autonomy; current level is ${effectiveLevel}`,
      profile: normalized,
      required,
    };
  }

  const lowRiskLocalExecute = new Set(["screen_act", "desktop_control", "open_url", "youtube_open_video", "computer_use"]);
  const requiresConfirmation = Boolean(definition.risk === "commit"
    || (definition.risk === "execute" && effectiveLevel !== "autopilot" && !lowRiskLocalExecute.has(tool))
    || context.forceConfirmation);
  return { allowed: true, requiresConfirmation, profile: normalized, required, effectiveLevel };
}

module.exports = {
  AUTONOMY_LEVELS: LEVELS,
  DEFAULT_AUTONOMY_PROFILE: DEFAULT_PROFILE,
  normalizeAutonomyProfile: normalizeProfile,
  evaluateAutonomy,
  requiredAutonomyLevel: requiredLevel,
};
