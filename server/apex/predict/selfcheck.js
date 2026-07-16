// APEX Oracle — runtime invariants. Returns { ok, issues[] }. Fail → caller flags `degraded`.

function selfCheck(payload) {
  const issues = [];
  const chk = (cond, msg) => { if (!cond) issues.push(msg); };
  for (const h of payload.horizons || []) {
    chk(h.p05 <= h.p25 + 1e-9 && h.p25 <= h.p50 + 1e-9 && h.p50 <= h.p75 + 1e-9 && h.p75 <= h.p95 + 1e-9, `${h.horizon}: quantiles not monotone`);
    chk(h.s > 0 && h.sigmaH > 0, `${h.horizon}: non-positive vol`);
    chk(h.pUp >= 0 && h.pUp <= 1, `${h.horizon}: pUp out of [0,1]`);
    chk(Math.abs(h.edge) <= 1.0001, `${h.horizon}: edge out of range`);
    chk(Math.sign(h.p50 - h.spot) === (h.dir === "LONG" ? 1 : -1) || Math.abs(h.p50 - h.spot) < h.spot * 1e-4, `${h.horizon}: median/direction mismatch`);
    if (h.option) {
      const o = h.option;
      chk(Math.abs(o.delta) <= 1.001, `${h.horizon}: |delta|>1`);
      chk(o.gamma >= -1e-9 && o.vega >= -1e-9, `${h.horizon}: negative gamma/vega`);
      chk(o.impliedVol > 0 && o.impliedVol < 500, `${h.horizon}: IV out of (0,500%)`);
      chk(o.premium >= 0, `${h.horizon}: negative premium`);
    }
  }
  // horizon ordering: interval width should grow with tau
  const hs = (payload.horizons || []).slice().sort((a, b) => a.tau - b.tau);
  for (let i = 1; i < hs.length; i++) {
    const w0 = hs[i - 1].p95 - hs[i - 1].p05, w1 = hs[i].p95 - hs[i].p05;
    chk(w1 >= w0 - 1e-6, `interval width not increasing ${hs[i - 1].horizon}→${hs[i].horizon}`);
  }
  return { ok: issues.length === 0, issues };
}

module.exports = { selfCheck };
