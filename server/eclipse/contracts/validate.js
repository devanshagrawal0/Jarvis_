// ECLIPSE contract validation + small pure helpers. No side effects on load.
const crypto = require("crypto");

function id(prefix = "ecl") { return `${prefix}_${crypto.randomUUID()}`; }
function nowIso() { return new Date().toISOString(); }
function hashOf(input) {
  return crypto.createHash("sha256").update(typeof input === "string" ? input : JSON.stringify(input)).digest("hex");
}

// Flatten a Zod error into readable "path: message" lines (zod v4 `.issues`).
function formatIssues(error) {
  const issues = error && error.issues ? error.issues : [];
  return issues.map((i) => `${(i.path || []).join(".") || "<root>"}: ${i.message}`);
}

// Strict: throws a clean Error on invalid input. Use at trust boundaries.
function validate(schema, obj, label = "object") {
  const r = schema.safeParse(obj);
  if (!r.success) {
    const err = new Error(`[eclipse] invalid ${label}: ${formatIssues(r.error).join("; ")}`);
    err.code = "ECLIPSE_SCHEMA";
    err.issues = formatIssues(r.error);
    throw err;
  }
  return r.data;
}

// Soft: never throws — returns {ok, value, errors}. Use where the model produced JSON and a
// repair loop may retry (P1·W3 wires the retry; here we just surface the failure cleanly).
function safeValidate(schema, obj) {
  const r = schema.safeParse(obj);
  return r.success ? { ok: true, value: r.data, errors: [] } : { ok: false, value: null, errors: formatIssues(r.error) };
}

module.exports = { id, nowIso, hashOf, validate, safeValidate, formatIssues };
