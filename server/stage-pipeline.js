// The Stage pipeline (W3.4) — the single, clean render path.
//
//   Router  → decide: text | stage_render | open_widget, and lane LIVE|STABLE|FICTION
//   Acquire → LIVE: ground/fetch real data (its numbers are the ONLY allowed source)
//             STABLE: model knowledge (badged)   FICTION: invent freely (badged)
//   Render  → generate typed blocks via structured output, told to use ONLY the data
//   Gate    → LIVE: every rendered number must trace to the fetched data, else strip/abstain
//   Show    → emit a `stage-render` uiAction (the shape the existing renderer draws) + provenance
//
// The one invariant: a LIVE surface never shows a number that isn't in the fetched payload.

const { GoogleGenAI } = require("@google/genai");
const { MODELS, fallbacksFor } = require("./gemini-models");
const { createStageRouter } = require("./stage-router");
const { auditFaithfulness, numbersIn } = require("./stage-faithfulness");

// Render schema. label+value are REQUIRED *inside* each stat, which is what actually forces the
// model to fill them — an optional label gets silently dropped (Gemini returns ""), which is why a
// "tallest mountains" panel came out as three unlabelled heights. We take a heading + a typed stats
// array (+ optional bullets/note) and BUILD the block list in code, so the shape can't come out malformed.
const RENDER_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "short surface title (a few words)" },
    heading: { type: "STRING", description: "a heading naming the surface, shown at the top" },
    stats: {
      type: "ARRAY",
      description: "3-6 key figures, one per stat. Omit only if the answer is genuinely non-numeric.",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING", description: "the NAME of what the value describes — either the metric (a measure like a rate or a total) or the entity it belongs to (a place, person, team, or product). Required. Do NOT invent a value; derive it for the actual request." },
          value: { type: "STRING", description: "JUST the figure itself — a number, price, or percentage only (format examples only: '$5.00', '12%', '1,234'). Never a sentence, never the label." },
          delta: { type: "STRING", description: "optional change indicator, e.g. '+2.1%' or '-14'." },
        },
        required: ["label", "value"],
      },
    },
    bullets: { type: "ARRAY", items: { type: "STRING" }, description: "optional: non-numeric points, one per line." },
    note: { type: "STRING", description: "optional: one short line of context under the figures." },
  },
  required: ["title", "heading"],
};

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const uniq = (a) => a.filter((x, i) => x && a.indexOf(x) === i);

// A short nudge appended to every render instruction. The RENDER_SCHEMA (required label+value per
// stat) does the real enforcement; this just steers good choices of what to show.
const LAYOUT_RULES = `
Set "heading" to name the surface. Give 3-6 "stats", one per key figure: "label" is the NAME of what
the figure is (the metric, or the entity it belongs to) and "value" is JUST the figure itself
(a number, price, or percentage — these are FORMAT examples only, not answers: "$5.00", "12%",
"1,234"). Use "bullets" for any non-numeric points and "note" for one line of context. Derive every
figure from the actual request — do not copy the format examples. Don't repeat a figure across stats.`;

function sanitizeBlocks(raw) {
  const mapped = (Array.isArray(raw) ? raw : []).map((b) => {
    const type = String(b && b.type || "").toLowerCase();
    if (type === "stat") return { type: "stat", label: str(b.label, 60), value: str(b.value, 40), delta: str(b.delta, 24) };
    if (type === "list") return { type: "list", items: Array.isArray(b.items) ? b.items.map((i) => str(i, 400)).filter(Boolean).slice(0, 24) : [] };
    if (type === "heading") return { type: "heading", text: str(b.text, 160) };
    if (type === "divider") return { type: "divider" };
    return { type: "text", text: str(b.text, 4000) };
  }).filter((b) => b.type === "divider" || b.text || b.value || b.label || (b.items && b.items.length));
  // Collapse runs of dividers and trim leading/trailing ones — the model sometimes emits several.
  const out = [];
  for (const b of mapped) {
    if (b.type === "divider" && (!out.length || out[out.length - 1].type === "divider")) continue;
    out.push(b);
  }
  while (out.length && out[out.length - 1].type === "divider") out.pop();
  return out;
}

// Drop any stat card whose numbers aren't backed by the payload (last-resort after a repair retry).
function stripUnsupported(blocks, payloadText) {
  const payloadNums = numbersIn(payloadText);
  const supported = (n) => payloadNums.some((p) => n === p || Math.abs(n - p) <= Math.max(Math.abs(p) * 0.005, 0.01));
  return blocks.filter((b) => {
    if (b.type !== "stat") return true;
    return [...numbersIn(b.value || ""), ...numbersIn(b.delta || "")].every(supported);
  });
}

function createStagePipeline({ getSettings }) {
  const router = createStageRouter({ getSettings });

  // Turn the structured render response into the typed block list the Stage renderer draws.
  function blocksFrom(parsed) {
    const blocks = [];
    if (parsed.heading) blocks.push({ type: "heading", text: str(parsed.heading, 160) });
    for (const s of Array.isArray(parsed.stats) ? parsed.stats : []) {
      const label = str(s && s.label, 60);
      const value = str(s && s.value, 40);
      if (label || value) blocks.push({ type: "stat", label, value, delta: str(s && s.delta, 24) });
    }
    const bullets = (Array.isArray(parsed.bullets) ? parsed.bullets : []).map((b) => str(b, 400)).filter(Boolean).slice(0, 24);
    if (bullets.length) blocks.push({ type: "list", items: bullets });
    if (parsed.note) blocks.push({ type: "text", text: str(parsed.note, 600) });
    return blocks;
  }

  async function genBlocks(ai, instruction, dataText) {
    const contents = dataText ? `${instruction}\n\nDATA (the ONLY facts you may use):\n${dataText}` : instruction;
    for (const model of uniq([MODELS.main, ...fallbacksFor("main")])) {
      try {
        const resp = await ai.models.generateContent({
          model, contents,
          config: { temperature: 0, responseMimeType: "application/json", responseSchema: RENDER_SCHEMA },
        });
        const parsed = JSON.parse(resp.text || "{}");
        const blocks = blocksFrom(parsed);
        // Require real content (a heading alone isn't a surface).
        if (blocks.some((b) => b.type === "stat" || b.type === "list")) return { title: str(parsed.title, 120) || "Jarvis", blocks };
      } catch { /* try next model */ }
    }
    return null;
  }

  async function ground(ai, prompt) {
    for (const model of uniq([MODELS.main, ...fallbacksFor("main")])) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: `Give the concrete, CURRENT facts and figures needed to answer this, with the actual numbers stated explicitly: ${prompt}`,
          config: { tools: [{ googleSearch: {} }] },
        });
        const text = str(resp.text, 8000);
        const gm = resp.candidates && resp.candidates[0] && resp.candidates[0].groundingMetadata;
        const sources = ((gm && gm.groundingChunks) || [])
          .map((c) => (c && c.web ? { title: str(c.web.title || c.web.uri, 120), url: c.web.uri } : null))
          .filter(Boolean).slice(0, 5);
        if (text) return { text, sources };
      } catch { /* try next model */ }
    }
    return null;
  }

  function stageResult(r, decision, provenance) {
    const label = provenance.kind === "illustrative" ? "illustrative "
      : provenance.kind === "model-knowledge" ? "" : "";
    return {
      handled: true, decision,
      uiActions: [{ type: "stage-render", data: { title: r.title, blocks: r.blocks, provenance } }],
      text: `Rendered the ${label}surface on your screen, sir.`,
    };
  }

  async function run(prompt, ctx = {}) {
    const settings = getSettings ? getSettings() : {};
    if (!settings.geminiKey || !String(prompt || "").trim()) return { handled: false };

    const decision = await router.route(prompt, ctx);

    if (decision.form === "open_widget" && decision.widget_id) {
      return { handled: true, decision, uiActions: [{ type: "open-widget", id: decision.widget_id, focus: false }], text: `Opening the ${decision.widget_id} widget, sir.` };
    }
    if (decision.form !== "stage_render") return { handled: false, decision }; // text → the normal brain answers

    const ai = new GoogleGenAI({ apiKey: settings.geminiKey });

    if (decision.lane === "FICTION") {
      const r = await genBlocks(ai, `Build a Stage surface (typed blocks) for this request. This is ILLUSTRATIVE / sample content — invent plausible example values. Request: "${prompt}"${LAYOUT_RULES}`);
      return r ? stageResult(r, decision, { kind: "illustrative" }) : { handled: false, decision };
    }

    if (decision.lane === "STABLE") {
      const r = await genBlocks(ai, `Build a Stage surface (typed blocks) for this request using ONLY durable facts you are confident are correct. If unsure of a figure, omit it — never guess. Request: "${prompt}"${LAYOUT_RULES}`);
      return r ? stageResult(r, decision, { kind: "model-knowledge" }) : { handled: false, decision };
    }

    // LIVE — fetch first, render only from what came back.
    const g = await ground(ai, prompt);
    if (!g || !g.text) {
      return {
        handled: true, decision,
        uiActions: [{ type: "stage-render", data: { title: "No live data", blocks: [{ type: "text", text: "I couldn't fetch live data for that just now, so I won't guess. Try again in a moment or rephrase." }], provenance: { kind: "abstain" } } }],
        text: "I don't have live data for that right now, sir — I won't fabricate it.",
      };
    }
    let r = await genBlocks(ai, `Render a Stage surface (typed blocks) STRICTLY from the DATA below. Do NOT add, round, extrapolate, or invent ANY number, name, or figure that is not present in DATA. If a value the layout wants isn't in DATA, omit it. Request: "${prompt}"${LAYOUT_RULES}`, g.text);
    if (!r) return { handled: false, decision };

    let audit = auditFaithfulness(r.blocks, g.text);
    if (!audit.ok) {
      const r2 = await genBlocks(ai, `Your previous render included numbers NOT present in DATA (${audit.violations.map((v) => v.value).slice(0, 8).join(", ")}). Render again using ONLY numbers that appear verbatim in DATA; omit anything not in DATA. Request: "${prompt}"`, g.text);
      if (r2) { r = r2; audit = auditFaithfulness(r2.blocks, g.text); }
    }
    if (!audit.ok) { r.blocks = stripUnsupported(r.blocks, g.text); audit = auditFaithfulness(r.blocks, g.text); }
    if (!r.blocks.length) {
      return { handled: true, decision, uiActions: [{ type: "stage-render", data: { title: r.title || "No verifiable data", blocks: [{ type: "text", text: "I fetched data but couldn't render it without inventing numbers, so I stopped." }], provenance: { kind: "abstain" } } }], text: "I won't render that — I couldn't do it without guessing, sir." };
    }
    return stageResult(r, decision, { kind: "live", sources: g.sources, gateOk: audit.ok });
  }

  return { run };
}

// Deterministic gate: is this an EXPLICIT request to render a generative panel/dashboard? Pure
// function — decides only WHETHER to run the pipeline, not what it renders (the router/LLM does
// that). Requires both a render verb AND a panel noun, so normal chat and "the dashboard light is
// on" don't trigger it. Runs AFTER the widget resolvers, so "show the kalshi dashboard" opens the
// real Kalshi widget rather than a bespoke panel.
const PANEL_NOUN = /\b(panels?|dashboards?|surfaces?|breakdowns?|rundowns?|scorecards?)\b/i;
const PANEL_VERB = /\b(make|build|create|render|generate|show me|give me|put|display|draw up|lay out|bring up|pop up|open|whip up)\b/i;
function detectPanelRequest(text) {
  const p = String(text || "").trim();
  if (!p || p.length > 240) return false;
  return PANEL_NOUN.test(p) && PANEL_VERB.test(p);
}

module.exports = { createStagePipeline, RENDER_SCHEMA, sanitizeBlocks, detectPanelRequest };
