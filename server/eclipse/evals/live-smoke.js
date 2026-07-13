// One-call smoke: confirm the Gemini key + which model IDs actually resolve, before any
// expensive multi-agent run. Reads ONLY geminiKey from settings; never prints the key.
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { MODELS } = require("../../gemini-models");

const root = path.resolve(__dirname, "../../..");
let settings = {}; try { settings = JSON.parse(fs.readFileSync(path.join(root, "runtime/settings.json"), "utf8")); } catch {}
// Load ONLY GEMINI_API_KEY (user-authorized, single run). Value is never printed or persisted.
function keyFromEnvFile() {
  try { const m = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/m); return m ? m[1].replace(/^["']|["']$/g, "") : null; } catch { return null; }
}
const key = process.env.GEMINI_API_KEY || settings.geminiKey || keyFromEnvFile();
if (!key) { console.log("NO KEY found"); process.exit(1); }
console.log("key: loaded (" + key.length + " chars, value masked)");
module.exports = { loadKey: () => key, root, settings };
console.log("registry → main:", MODELS.main, "| reasoning:", MODELS.reasoning, "| router:", MODELS.router);
console.log("settings overrides → model:", settings.geminiModel || "(none)", "| reasoning:", settings.geminiReasoningModel || "(none)");

const candidates = [
  settings.geminiModel, MODELS.main, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash",
].filter((v, i, a) => v && a.indexOf(v) === i);

(async () => {
  const ai = new GoogleGenAI({ apiKey: key });
  for (const model of candidates) {
    try {
      const r = await ai.models.generateContent({ model, contents: "Reply with exactly the word: OK" });
      console.log(`  ✓ ${model} → "${String(r.text || "").trim().slice(0, 30)}"  (tokens ~${r.usageMetadata?.totalTokenCount ?? "?"})`);
      console.log("\nWORKING FLASH MODEL:", model);
      process.exit(0);
    } catch (e) {
      console.log(`  ✗ ${model} → ${String(e.message || e).slice(0, 90)}`);
    }
  }
  console.log("\nNo candidate flash model worked.");
  process.exit(1);
})();
