// ECLIPSE agent reputation (P2·W6) — track how well each blueprint/persona actually performs
// across missions and let good ones earn promotion, bad ones get retired. Reputation is an EWMA
// of a quality signal (validated-packet rate), so recent performance dominates. Persisted to
// eclipse_agent_reputation. Deterministic; no model.
const { nowIso } = require("../contracts/validate");

const ALPHA = 0.3;                 // EWMA weight on the newest observation
const PROMOTE_AT = 0.75, RETIRE_AT = 0.25, MIN_MISSIONS = 3;

function createReputation(db) {
  const q = {
    get: db.prepare(`SELECT * FROM eclipse_agent_reputation WHERE blueprint_id=? AND persona=?`),
    upsert: db.prepare(`INSERT INTO eclipse_agent_reputation(blueprint_id,persona,missions,validated,packets,tokens,cost_usd,reputation,status,updated_at)
      VALUES(@blueprint_id,@persona,@missions,@validated,@packets,@tokens,@cost_usd,@reputation,@status,@updated_at)
      ON CONFLICT(blueprint_id,persona) DO UPDATE SET missions=@missions,validated=@validated,packets=@packets,tokens=@tokens,cost_usd=@cost_usd,reputation=@reputation,status=@status,updated_at=@updated_at`),
    all: db.prepare(`SELECT * FROM eclipse_agent_reputation ORDER BY reputation DESC`),
  };

  // recordOutcome({blueprintId, persona, validated, packets, tokens, costUsd}) → updated row.
  function recordOutcome({ blueprintId, persona = "", validated = 0, packets = 0, tokens = 0, costUsd = 0 }) {
    const prev = q.get.get(blueprintId, persona) || { missions: 0, validated: 0, packets: 0, tokens: 0, cost_usd: 0, reputation: 0.5, status: "active" };
    const signal = packets > 0 ? validated / packets : prev.reputation; // no packets → no new signal
    const reputation = clamp01(ALPHA * signal + (1 - ALPHA) * prev.reputation);
    const missions = prev.missions + 1;
    let status = prev.status === "promoted" || prev.status === "retired" ? prev.status : "active";
    if (missions >= MIN_MISSIONS) {
      if (reputation >= PROMOTE_AT) status = "promoted";
      else if (reputation <= RETIRE_AT) status = "retired";
    }
    const row = {
      blueprint_id: blueprintId, persona, missions,
      validated: prev.validated + validated, packets: prev.packets + packets,
      tokens: prev.tokens + tokens, cost_usd: prev.cost_usd + costUsd,
      reputation: Number(reputation.toFixed(4)), status, updated_at: nowIso(),
    };
    q.upsert.run(row);
    return row;
  }

  function get(blueprintId, persona = "") { return q.get.get(blueprintId, persona) || null; }
  function reputationOf(blueprintId, persona = "") { const r = q.get.get(blueprintId, persona); return r ? r.reputation : 0.5; }
  function isRetired(blueprintId, persona = "") { const r = q.get.get(blueprintId, persona); return !!(r && r.status === "retired"); }
  function list() { return q.all.all(); }

  // pickBest(blueprintId, personas[]) → the non-retired persona with the highest reputation.
  function pickBest(blueprintId, personas = [""]) {
    const scored = personas.filter((p) => !isRetired(blueprintId, p)).map((p) => ({ persona: p, rep: reputationOf(blueprintId, p) }));
    if (!scored.length) return personas[0];
    scored.sort((a, b) => b.rep - a.rep);
    return scored[0].persona;
  }

  return { recordOutcome, get, reputationOf, isRetired, list, pickBest, PROMOTE_AT, RETIRE_AT };
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

module.exports = { createReputation, ALPHA, PROMOTE_AT, RETIRE_AT, MIN_MISSIONS };
