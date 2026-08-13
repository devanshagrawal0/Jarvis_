# The Stage — honest rebuild plan (render structured surfaces without lying)

Written 2026-08-13 after ripping out the hack-pile. Backed by two research passes
(reliable render-routing; anti-fabrication). Sources at the bottom.

---

## 1. Why it broke (diagnosis, not excuses)

- I made **one** Gemini call try to do three jobs at once: decide the presentation
  form, reason/ground the content, AND emit the `blocks` spec — then bolted
  keyword-regex gates + global tool-forcing on top. That is exactly the anti-pattern
  every production generative-UI system avoids.
- **Hard Gemini 2.5 constraint I didn't know:** `googleSearch` (grounding) and
  `functionDeclarations` (like `stage_render`) **cannot be in the same request** on
  2.5 Flash. When mixed, the API drops one. So my "skip grounding so it can render"
  was fighting a hard API rule — which is *the* reason the same class of prompt
  rendered sometimes and grounded/fabricated other times.
- **Fabrication:** because the render step both *sourced* and *drew* the numbers,
  any real-data request (latest prices, "my tasks") produced confident invented
  figures. Fiction is fine; real-data fabrication is dangerous.

## 2. The one invariant (everything serves this)

> A data-bearing card may only show a value that exists in a **fetched/real payload**
> (carrying a source). If there is no payload, the Stage **abstains** — it never lets
> the render step originate a number. Fiction is allowed but **badged "illustrative."**

The render model becomes a **formatter of grounded data**, never an **author of data**.

## 3. Target architecture — Route → Acquire → Render → Gate → Show

**A. ROUTER** — one cheap dedicated `gemini-flash-lite` call, **structured JSON**
(`responseSchema`), reasoning-first. Returns:
```
{ reasoning, form: "text" | "stage_render" | "open_widget",
  lane: "LIVE" | "STABLE" | "FICTION", widget_id?, confidence }
```
Steered by explicit **positive + negative criteria** (Anthropic-Artifacts style:
"render blocks when the answer is quantitative/comparative/multi-entity/scheduley…;
answer as text for short/conversational/single-value…; open an existing widget when
one already covers it"). **No regex.** Low confidence ⇒ treat as LIVE (fail safe).

**B. ACQUIRE (by lane)** — get real data before any rendering:
- `LIVE` → **Pass 1**: grounding (`googleSearch`) for public data, or our own
  function tools (atlas/kalshi/etc.) for "my X". Capture values **+ provenance**
  (URLs/titles/timestamps from grounding metadata, or tool name + fetch time).
  Nothing sufficient back ⇒ **abstain card**, do not render.
- `STABLE` → model knowledge allowed, card **badged "model knowledge, not live."**
- `FICTION` → invent freely, card **badged "illustrative / sample."**

**C. RENDER (Pass 2), payload-locked** — only if router said `stage_render`. Render
tool **ON**, search **OFF** (no 2.5 conflict). Forced locally:
`toolConfig.functionCallingConfig = { mode: ANY, allowedFunctionNames: ["stage_render"] }`,
small schema, reasoning-first field, tamed thinking budget (avoids
`MALFORMED_FUNCTION_CALL`/empty). System rule: *"Render ONLY values present in DATA;
attach the given source to each; never add, round, extrapolate, or invent a number."*

**D. GATE (deterministic, in code)** — walk the rendered JSON; every data leaf must
trace to the payload (exact/normalized match) **or** carry a valid source ref, else
**block + one repair retry**. This is the check that *cannot fail silently* — it
mechanically cannot pass an invented number.

**E. SHOW (provenance in the UI)** — every card shows where each number came from: a
source chip (LIVE), a "model knowledge" tag (STABLE), an "illustrative" tag
(FICTION). The **abstain state** ("No live data for X") is a first-class card, not an
error.

## 4. Step 0 — verify the constraint BEFORE building

Test in our codebase whether current 2.5 Flash still forbids `googleSearch` +
`stage_render` in one request. Result decides:
- Still forbidden → **two-pass** (Acquire, then Render) on 2.5 Flash. Works today.
- Lifted (Gemini 3 tool-combo + "context circulation") → LIVE lane can be **single
  pass** on a Gemini-3 model. Upgrade path, optional.

## 5. Build waves (small, each verified with REAL + varied inputs, you're the gate)

- **W3.1 — Router only.** The dedicated structured-JSON decision call. Returns
  text/render/widget + lane; **renders nothing yet** — just logs the decision.
  *Test:* ~15 varied real + fictional prompts → correct form + lane, checked against
  reality (not fiction-only). This alone replaces the regex with real judgment.
- **W3.2 — FICTION render path.** Router says FICTION → forced payload-render →
  blocks with an "illustrative" badge. *Test:* fictional prompts render; confirm **no
  real-data prompt reaches this path.**
- **W3.3 — The GATE + provenance scaffolding.** Wire the deterministic value-diff.
  *Test:* give it a payload + a render that invents a number → gate blocks it. A
  check that goes red on a real injected fabrication.
- **W3.4 — LIVE path.** Pass-1 fetch (grounding + private tools) → payload → Pass-2
  payload-locked render with source chips. *Test with REAL queries:* "latest S&P
  price", "what's on my calendar" → real numbers with sources, or honest abstain.
  Fabrication becomes impossible here.
- **W3.5 — STABLE path** (model knowledge, badged) + polish.

## 6. Open decisions for Dev

1. **Router placement:** separate cheap Flash-Lite call (robust, +1 call latency,
   independently testable — research's recommendation) vs. tool-descriptions-in-context
   (0 latency, weaker on Gemini AUTO). — *recommend: separate router.*
2. **Model for LIVE lane:** two-pass on 2.5 Flash now, or move LIVE to Gemini 3
   single-pass — pending Step 0.
3. **Scope now:** build the whole pipeline, or start W3.1 (router) + W3.3 (gate) so
   the two hardest, most valuable pieces (real decision + can't-fabricate guard) land
   first, then the render lanes.

## Sources
Render routing: Vercel AI SDK 3.0 GenUI; Thesys C1 / OpenUI; Google A2UI; Anthropic
Artifacts criteria; Gemini function-calling (`functionCallingConfig` AUTO/ANY/NONE,
`allowedFunctionNames`); Gemini structured output; CRANE (decouple reasoning from
constrained formatting); grounding-vs-tools conflict (go-genai #323, litellm #27479,
vercel/ai #8258). Anti-fabrication: fetch-then-render (AI SDK 3.0 `streamUI`);
Adaptive-RAG / Self-RAG / SKR routing; Gemini grounding metadata (groundingChunks /
groundingSupports / url_citation); abstention survey (TACL) + "Don't Hallucinate,
Abstain"; deterministic groundedness/value-diff (deepset Reference Predictor;
faithfulness-metrics review); Gemini-3 tool-combo + context circulation.
