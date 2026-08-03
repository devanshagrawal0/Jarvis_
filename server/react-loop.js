// ReAct (Reason + Act) multi-turn loop for autonomous Jarvis agents.
// Used by mission executor: thought → action → observe → repeat up to maxIterations.

const MAX_ITERATIONS = 10;
const REACT_SYSTEM = `You are a Jarvis autonomous agent executing a mission using the ReAct pattern.

At each step, output one of:
1. Thought: <reasoning about what to do next and why>
2. Action: <tool call> — call exactly one tool
3. Final Answer: <your synthesized response when the mission is done>

Rules:
- Always begin with a Thought before calling any tool
- After each tool result (Observation), reason before acting again
- Stop with Final Answer once evidence is collected and verified
- Never claim a result you didn't observe from a tool
- If stuck after 3 attempts on the same step, output Final Answer with what was found`;

// Mirrors the taint rule in server.js: only tools that pull EXTERNAL content mark the run as
// possibly-influenced. Owner-scoped reads (memory, status, skills) taint nothing.
const UNTRUSTED_CONTENT_TOOL = /^(?:url_read|web_research|web_research_deep|research_v2|browser_|screen_|computer_use|read_clipboard|gmail_|instagram_|canvas_|news_headlines|device_files|device_latest_image)/i;

function parseReActStep(text) {
  const thoughtMatch = text.match(/Thought:\s*(.+?)(?=\nAction:|Final Answer:|$)/si);
  const finalMatch = text.match(/Final Answer:\s*([\s\S]+?)$/i);
  return {
    thought: thoughtMatch?.[1]?.trim() || null,
    isFinal: Boolean(finalMatch),
    finalAnswer: finalMatch?.[1]?.trim() || null,
  };
}

async function createReActExecutor({ capabilityEngine, getSettings, getDeclarations }) {
  async function execute(mission, options = {}) {
    const {
      maxIterations = MAX_ITERATIONS,
      onStep = null,
    } = options;

    const settings = getSettings();
    const apiKey = settings?.geminiKey || settings?.geminiApiKey;
    if (!apiKey) throw new Error("Gemini API key is not configured");

    const GEMINI_BASE = "https://generativelanguage.googleapis.com";
    const model = "gemini-3.5-flash"; // Cortex v4 0.2 — registry model (was obsolete gemini-2.0-flash)

    const declarations = getDeclarations(mission);
    const contents = [
      {
        role: "user",
        parts: [{
          text: [
            `Mission: ${mission.objective}`,
            `Role: ${mission.roleInstruction}`,
            `Plan: ${(mission.checkpoint?.plan || []).join(" → ")}`,
            mission.checkpoint?.childResults?.length
              ? `Evidence from sub-agents:\n${JSON.stringify(mission.checkpoint.childResults, null, 2)}`
              : "",
            "Begin by thinking about what you know and what you need to find out.",
          ].filter(Boolean).join("\n\n"),
        }],
      },
    ];

    const steps = [];
    let finalAnswer = null;
    let toolResults = [];
    let stuck = 0;
    let lastTool = null;
    let untrustedContentSeen = false;

    for (let i = 0; i < maxIterations; i++) {
      const tools = declarations.length ? [{ functionDeclarations: declarations }] : [];
      let data;
      try {
        const res = await fetch(
          `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: REACT_SYSTEM }] },
              contents,
              ...(tools.length ? { tools, toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
              generationConfig: { maxOutputTokens: 1200 },
            }),
          },
        );
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message || `Gemini ${res.status}`);
      } catch (err) {
        steps.push({ iteration: i, error: err.message });
        break;
      }

      const parts = data.candidates?.[0]?.content?.parts || [];
      contents.push({ role: "model", parts });

      const text = parts.map((p) => p.text).filter(Boolean).join("\n").trim();
      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

      const { thought, isFinal, finalAnswer: fa } = parseReActStep(text || "");

      const step = { iteration: i, thought, text, toolCalls: [], observations: [] };

      if (isFinal) {
        finalAnswer = fa || text;
        steps.push(step);
        break;
      }

      if (!functionCalls.length) {
        // Model gave text with no tool call — treat as final answer if it has substance
        if (text && text.length > 20 && i > 0) {
          finalAnswer = text;
          steps.push(step);
          break;
        }
        // Reasoning turn without tool call — reset stuck counter so interleaved reasoning
        // doesn't cause premature bailout when the same tool is used before/after a think step
        stuck = 0;
        lastTool = null;
        // Nudge the model
        contents.push({ role: "user", parts: [{ text: "Call a tool or output Final Answer." }] });
        steps.push(step);
        continue;
      }

      const responseParts = [];
      for (const call of functionCalls) {
        // Stuck detection: same tool 3 times in a row
        if (call.name === lastTool) {
          stuck++;
          if (stuck >= 3) {
            finalAnswer = `Mission stalled: ${call.name} was called 3 times in a row with no progress. ${summarizeToolResults(toolResults)}`;
            break;
          }
        } else {
          stuck = 0;
          lastTool = call.name;
        }

        // `indirect: true` was hardcoded, which is the same category error as B-04: it means
        // "these arguments may have been shaped by content the owner didn't write", not "this is
        // a background run". Hardcoding it denied a mission every non-observe tool outright, so
        // an agent could never write a file or run a command no matter what it was asked to do.
        // Provenance decides it here too — external content raises the flag, owner data doesn't.
        if (UNTRUSTED_CONTENT_TOOL.test(call.name)) untrustedContentSeen = true;
        const execution = await capabilityEngine.execute(call.name, call.args || {}, {
          source: "mission",
          indirect: untrustedContentSeen,
        });
        toolResults.push({ tool: call.name, ...execution });
        step.toolCalls.push(call.name);
        step.observations.push({ tool: call.name, ok: execution.ok, result: execution.result });

        onStep?.({ type: "tool", iteration: i, tool: call.name, ok: execution.ok });

        responseParts.push({
          functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name: call.name,
            response: { ok: execution.ok, result: execution.result, error: execution.error },
          },
        });
      }

      if (stuck >= 3) {
        steps.push(step);
        break;
      }

      if (responseParts.length) {
        contents.push({ role: "user", parts: responseParts });
      }
      steps.push(step);
    }

    if (!finalAnswer) {
      // `JSON.stringify(toolResults.slice(-2))` shipped whole execution envelopes as the
      // user-facing answer: absolute paths, receipts, internal error strings, and (before B-06)
      // PowerShell source. A readable summary is the answer; the envelopes stay on `toolResults`
      // for callers that actually want them.
      finalAnswer = toolResults.length
        ? summarizeToolResults(toolResults)
        : "Mission completed with no tool evidence collected.";
    }

    // A confirmation with no `id` and no `ownerChallenge` cannot be approved by anything — the
    // approve handler keys on both — so emitting one produced a prompt that could never be
    // satisfied and a mission that simply hung. Only genuinely approvable confirmations are
    // surfaced; tools refused for want of an owner session are reported as blocked instead.
    const pendingConfirmations = toolResults
      .map((item) => item.confirmation)
      .filter((item) => item && item.id && item.ownerChallenge);
    const blockedForApproval = toolResults
      .filter((item) => item.status === "approval_session_required"
        || (item.confirmation && !(item.confirmation.id && item.confirmation.ownerChallenge)))
      .map((item) => ({ tool: item.tool, reason: "needs owner approval, which a background mission cannot request" }));

    return {
      response: finalAnswer,
      steps,
      toolResults,
      iterations: steps.length,
      pendingConfirmations,
      blockedForApproval,
    };
  }

  return { execute };
}

// Renders tool results as something the owner can read. The previous behaviour serialised the
// raw execution envelopes into the answer, which leaked absolute paths, receipts and internal
// error text into what was presented as prose.
function summarizeToolResults(results = []) {
  const list = Array.isArray(results) ? results : [];
  const ok = list.filter((item) => item.ok).length;
  const failed = list.filter((item) => !item.ok);
  const parts = [`Completed ${list.length} tool operation${list.length === 1 ? "" : "s"} (${ok} succeeded).`];
  const named = [...new Set(list.map((item) => item.tool).filter(Boolean))].slice(0, 6);
  if (named.length) parts.push(`Used: ${named.join(", ")}.`);
  for (const item of failed.slice(0, 3)) {
    const reason = String(item.error || "no reason reported").split(/\r?\n/)[0].slice(0, 160);
    parts.push(`${item.tool} failed: ${reason}`);
  }
  return parts.join(" ");
}
module.exports = { createReActExecutor };
