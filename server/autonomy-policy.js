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

  // Writes to the owner's own local day-model (ATLAS: tasks / events / reminders) are low-risk and
  // reversible — deleting is one command — so they run without a confirmation click, like the owner
  // typing into the Today widget. (Google Calendar / email writes are NOT here; those still confirm.)
  const lowRiskLocalExecute = new Set(["screen_act", "desktop_control", "open_url", "youtube_open_video", "computer_use",
    "atlas_capture", "atlas_add_task", "atlas_add_event", "atlas_add_reminder",
    // Completing / rescheduling a LOCAL Today item is reversible (re-open, move back) and mirrors the
    // owner clicking on their own board, so it runs without a confirmation click. atlas_cancel_item is
    // deliberately NOT here — it deletes local data, so it keeps the confirmation gate.
    "atlas_complete_task", "atlas_reschedule_event", "atlas_undo", "atlas_log_past"]);
  // Arbitrary code execution is never routine. `run_command` shells out with
  // -ExecutionPolicy Bypass, and its own blocklist is a resource-exhaustion heuristic rather than
  // a security boundary — every entry is trivially expressible another way (ForEach-Object for
  // loops, &('i'+'ex') for Invoke-Expression, cmd /c start for Start-Process). The confirmation
  // was therefore the only real gate, and `effectiveLevel !== "autopilot"` removed it at the
  // highest autonomy level. Autopilot should mean "stop asking about routine actions", not "run
  // any shell command unattended", so this one is confirmed at every level.
  // email_smart is a one-step external SEND. It is `execute` risk, which means at the "autopilot"
  // level the generic gate below would let it fire with NO confirmation — and because it composes the
  // body at send time, an un-approved send is exactly the "wrong recipient + hallucinated body went
  // out behind my back" failure. An outbound email is irreversible and leaves the machine, so it is
  // confirmed at EVERY autonomy level, like run_command. (The preferred path is still
  // gmail_prepare_email → gmail_send_prepared, whose approval is bound to an exact provider draft.)
  const alwaysConfirm = new Set(["run_command", "email_smart"]);
  const requiresConfirmation = Boolean(definition.risk === "commit"
    || alwaysConfirm.has(tool)
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
