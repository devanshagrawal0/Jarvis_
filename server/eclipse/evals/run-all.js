// Run every Eclipse eval suite in one process. `node server/eclipse/evals/run-all.js`.
// All suites are local + deterministic + ZERO Gemini. Exit 1 if any suite fails.
const { execFileSync } = require("child_process");
const path = require("path");
const suites = ["test-contracts.js", "test-routing.js", "test-model.js", "test-graph.js", "test-stream.js", "test-leases.js", "test-agents.js", "test-mission-e2e.js", "test-tools.js", "test-evidence.js", "test-w5-e2e.js"];
let failed = 0;
for (const s of suites) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, s)], { encoding: "utf8" });
    const last = out.trim().split("\n").pop();
    console.log(`${s.padEnd(20)} ${last}`);
  } catch (e) {
    failed++;
    console.log(`${s.padEnd(20)} FAILED`);
    process.stdout.write((e.stdout || "") + (e.stderr || ""));
  }
}
console.log(failed ? `\n${failed} suite(s) FAILED` : `\nALL ECLIPSE SUITES GREEN`);
process.exit(failed ? 1 : 0);
