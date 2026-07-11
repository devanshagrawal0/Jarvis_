// Arbiter scheduler — runs the scan on an interval, persists edges to the
// scorecard DB, grades resolved markets, and pushes new high-confidence edges
// to the owner via Telegram.
const { recordEdges, markResolved, openEdges } = require("./arbiter-db");

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

function startArbiterScheduler({ engine, providers, notify, intervalMs = DEFAULT_INTERVAL_MS }) {
  let timer = null;
  let running = false;

  async function grade(nowIso) {
    const open = openEdges();
    // Grade at most a handful per cycle to avoid hammering the API.
    for (const row of open.slice(0, 8)) {
      const polyId = String(row.id).split("-").slice(1).join("-");
      const res = await providers.polymarket.marketById(polyId).catch(() => null);
      if (res && res.closed && res.resolvedOutcome) {
        markResolved(row.id, res.resolvedOutcome, nowIso);
      }
    }
  }

  function alertText(edges) {
    const lines = edges.map((e) => {
      const cmp = e.leftLabel === "JARVIS"
        ? `JARVIS ${e.kalshi}% vs market ${e.polymarket}¢`
        : `Kalshi ${e.kalshi}¢ vs Polymarket ${e.polymarket}¢`;
      return `<b>+${e.edgeScore} ${e.confidence}</b> · ${e.category}\n${e.question}\n${cmp} — ${e.signals.join(", ")}`;
    });
    return `⚡ <b>Arbiter — ${edges.length} new edge${edges.length > 1 ? "s" : ""}</b>\n\n${lines.join("\n\n")}`;
  }

  async function cycle() {
    if (running) return;
    running = true;
    try {
      const result = await engine.scan();
      const nowIso = result.scannedAt || new Date().toISOString();
      const { insertedIds } = recordEdges(result.edges, nowIso);
      await grade(nowIso);

      // Push only NEW edges that clear the high-confidence bar.
      const newHigh = result.edges.filter(
        (e) => insertedIds.includes(e.id) && (e.confidence === "VERY HIGH" || e.confidence === "HIGH")
      );
      if (newHigh.length && notify) {
        await notify(alertText(newHigh.slice(0, 5))).catch(() => {});
      }
      console.log(`[Arbiter] scan: ${result.edges.length} edges, ${insertedIds.length} new, ${newHigh.length} pushed`);
    } catch (err) {
      console.error("[Arbiter] scheduler cycle failed:", err.message);
    } finally {
      running = false;
    }
  }

  // Kick off shortly after boot, then on the interval.
  const kickoff = setTimeout(() => { void cycle(); }, 8000);
  timer = setInterval(() => { void cycle(); }, intervalMs);

  return {
    stop() { clearTimeout(kickoff); clearInterval(timer); },
    runNow: cycle,
  };
}

module.exports = { startArbiterScheduler };
