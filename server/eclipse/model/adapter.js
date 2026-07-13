// ECLIPSE model adapter — the ONE model-call boundary (ADR-006). It owns: node→model
// routing, structured-output validation + repair loop, retry/fallback classification, and
// per-mission cost accounting. It is provider-agnostic: the actual network call is an
// injected function, so all of this logic is unit-testable with ZERO Gemini spend.
//
//   mode "stub"  → uses stubResponder(call) (deterministic; default = echo). Tests use this.
//   mode "live"  → uses liveCall(call): the real @google/genai Interactions call, injected by
//                  the runtime wiring (background=true + store, previous_interaction_id,
//                  thought-signature passthrough). Flag-gated; never runs in tests.
//
// The Interactions contract the liveCall MUST honor (encoded here as the `call` it receives and
// the shape it must return) is documented in ADR-006 §Research-confirmed backbone.
const { modelForNode, fallbackRole, registry } = require("./capabilities");
const retry = require("./retry");

const estTokens = (s) => Math.ceil(String(s || "").length / 4); // ~4 chars/token heuristic

// Default deterministic stub: echoes node + a stable short hash of the input. If the caller
// wants structured json in stub mode it must supply `stub.json` per call (tests do this).
function defaultStub(call) {
  const h = String(call.input || "").split("").reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);
  return {
    text: `[stub:${call.node}] ${h}`,
    json: call.stub && "json" in call.stub ? call.stub.json : undefined,
    usage: { tokensIn: estTokens(call.system) + estTokens(call.input), tokensOut: 24 },
  };
}

function createAdapter({ mode = "stub", ledger = null, stubResponder = defaultStub, liveCall = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const isLive = mode === "live";
  if (isLive && typeof liveCall !== "function") throw new Error("[eclipse] live adapter requires a liveCall function");

  // One provider call attempt (no retry logic here). Returns provider result shape.
  async function callOnce(call) {
    if (isLive) return liveCall(call);
    const r = (call.stub && (call.stub.text || call.stub.json || call.stub.throw)) ? call.stub : stubResponder(call);
    if (r && r.throw) throw r.throw; // stub can script an error for retry tests
    return r;
  }

  // run: resolve model, spend-guard, call with retry/fallback, validate+repair structured output.
  // opts: { node, effort, system, input, schema?, tools?, previousInteractionId?, idempotencyKey?, stub? }
  async function run(opts) {
    const { node, effort = "deep", system = "", input = "", schema = null } = opts;
    let spec = modelForNode(node, effort);
    if (!spec) throw new Error(`[eclipse] node "${node}" has no model role (model-less node must not call run())`);

    // Pre-flight spend guard: refuse a call that would blow the cap rather than paying first.
    const preEst = estTokens(system) + estTokens(input);
    if (ledger) ledger.assertWithinCap(preEst, (preEst / 1e6) * spec.cost.in);

    let attempt = 0, lastErr = null, role = spec.role;
    while (attempt <= retry.MAX_ATTEMPTS) {
      try {
        const call = { ...opts, modelId: spec.modelId, role, thinking: spec.thinking };
        let res = await callOnce(call);
        const out = await validateAndRepair(res, call, schema);
        // Account usage.
        const usage = out.usage || res.usage || { tokensIn: preEst, tokensOut: 0 };
        if (ledger) ledger.add({ node, tokensIn: usage.tokensIn || 0, tokensOut: usage.tokensOut || 0, cost: spec.cost });
        return {
          text: out.text ?? res.text ?? "",
          json: out.json,
          interactionId: res.interactionId || null,
          thoughtSignature: res.thoughtSignature || null,
          usage, modelId: spec.modelId, role, node,
          repaired: out.repaired || 0,
        };
      } catch (err) {
        lastErr = err;
        // Schema/validation errors are not provider errors — surfaced by validateAndRepair only
        // after it exhausts repairs; re-throw so the node can decide.
        if (err && err.code === "ECLIPSE_OUTPUT") throw err;
        if (err && err.code === "ECLIPSE_BUDGET") throw err;
        const pol = retry.classify(err, attempt);
        if (pol.fatal || (!pol.retry && !pol.fallback && !pol.fixDontRetry)) throw err;
        if (pol.fixDontRetry && !pol.retry) throw err; // 400 with no schema-repair path
        if (pol.fallback) {
          const fb = fallbackRole(role);
          if (fb !== role) { role = fb; spec = { ...spec, role: fb, modelId: registry.modelFor(fb) }; }
        }
        if (pol.backoffMs) await sleep(pol.backoffMs);
        attempt += 1;
      }
    }
    throw lastErr || new Error(`[eclipse] run("${node}") exhausted retries`);
  }

  // Structured-output repair loop: validate json vs schema; on failure, re-call the provider
  // up to 2× feeding the validation errors back. Deterministic in stub mode when the stub is
  // scripted to return corrected json on the repair pass.
  async function validateAndRepair(res, call, schema) {
    if (!schema) return { text: res.text, json: undefined, usage: res.usage, repaired: 0 };
    let current = res, repaired = 0;
    for (let i = 0; i <= 2; i++) {
      const candidate = current.json !== undefined ? current.json : safeJson(current.text);
      const parsed = schema.safeParse(candidate);
      if (parsed.success) return { text: current.text, json: parsed.data, usage: current.usage, repaired };
      if (i === 2) {
        const e = new Error(`[eclipse] structured output failed validation after ${repaired} repair(s)`);
        e.code = "ECLIPSE_OUTPUT"; e.issues = parsed.error?.issues; throw e;
      }
      repaired += 1;
      const errText = (parsed.error?.issues || []).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
      current = await callOnce({ ...call, input: `${call.input}\n\n[repair] Your previous output failed validation: ${errText}. Return corrected JSON only.`, repairPass: repaired });
    }
    return { text: res.text, json: undefined, usage: res.usage, repaired };
  }

  return { run, mode };
}

function safeJson(text) { try { return JSON.parse(String(text)); } catch { return undefined; } }

module.exports = { createAdapter, defaultStub, estTokens };
