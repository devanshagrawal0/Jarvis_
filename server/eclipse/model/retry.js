// ECLIPSE retry/fallback classification. Turns a provider error into a deterministic policy:
//   429 / RESOURCE_EXHAUSTED  → retry with exponential backoff (rate limit — transient)
//   503 / UNAVAILABLE / 500   → retry a couple times, then FALL BACK a tier (Pro→Flash→Lite)
//   408 / ECONNRESET / socket → retry with backoff (network transient)
//   400 / INVALID_ARGUMENT    → do NOT retry; the request is malformed → fix (e.g. schema repair)
//   401 / 403 / PERMISSION    → do NOT retry; auth/config problem → surface to user
// Backoff is decorrelated-jitter-free deterministic (base·2^attempt capped) so tests are stable.

function statusOf(err) {
  if (!err) return 0;
  const s = err.status ?? err.statusCode ?? err.code;
  if (typeof s === "number") return s;
  const m = String(err.message || err.status || err.code || "").match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : 0;
}
function nameOf(err) { return String((err && (err.status || err.code || err.name || err.message)) || "").toUpperCase(); }

const BASE_MS = 500, MAX_MS = 30000, MAX_ATTEMPTS = 3;

// attempt is 0-based (0 = first retry decision after the initial failure).
function classify(err, attempt = 0) {
  const status = statusOf(err);
  const name = nameOf(err);
  const backoff = Math.min(MAX_MS, BASE_MS * Math.pow(2, attempt));

  const rateLimited = status === 429 || /RESOURCE_EXHAUSTED|RATE.?LIMIT|TOO MANY/.test(name);
  const transient = status === 503 || status === 500 || status === 502 || status === 504 || status === 408 ||
    /UNAVAILABLE|INTERNAL|ECONNRESET|ETIMEDOUT|EAI_AGAIN|SOCKET|FETCH FAILED/.test(name);
  const badRequest = status === 400 || /INVALID_ARGUMENT|FAILED_PRECONDITION|400/.test(name);
  const authErr = status === 401 || status === 403 || /PERMISSION_DENIED|UNAUTHENTICATED/.test(name);

  if (rateLimited) return { kind: "rate_limit", retry: attempt < MAX_ATTEMPTS, backoffMs: backoff, fallback: false, fixDontRetry: false };
  if (transient)   return { kind: "transient", retry: attempt < MAX_ATTEMPTS, backoffMs: backoff, fallback: attempt >= 1, fixDontRetry: false };
  if (badRequest)  return { kind: "bad_request", retry: false, backoffMs: 0, fallback: false, fixDontRetry: true };
  if (authErr)     return { kind: "auth", retry: false, backoffMs: 0, fallback: false, fixDontRetry: false, fatal: true };
  // Unknown: one cautious retry, no fallback.
  return { kind: "unknown", retry: attempt < 1, backoffMs: backoff, fallback: false, fixDontRetry: false };
}

module.exports = { classify, statusOf, MAX_ATTEMPTS, BASE_MS, MAX_MS };
