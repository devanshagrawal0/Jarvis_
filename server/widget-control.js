// Deterministic resolver for widget CONTROL commands the brain used to fake — normalize/unfocus,
// minimize, resize. Pure function: no LLM, no network, no await. It runs in the existing fast-path
// beside detectWidgetOpen, so normal chat pays ~0ms and any non-command falls straight through to
// the brain untouched.
//
// It NEVER fakes success: if it can't resolve a real, open target it returns null (the brain then
// handles the turn) — it does not emit a bogus action or a "done, sir" for something that didn't
// happen. detectWidgetOpen already owns open/focus/expand; this owns the rest of the verb class.
//
// This IS pattern-matching on the owner's words (a deliberate, flagged trade-off): direct window
// commands like "normal view" / "minimize it" want a reliable mapping, not an LLM deciding. The
// safety comes from a strict gate — it only fires when there is a real widget signal (a named
// widget, a widget/panel/window noun, or a coreference to a widget that is actually focused/open).

// Action verbs. Order matters: first match wins.
const ACTIONS = [
  ["normalize", /\b(?:normal(?:\s*(?:view|size|mode|window))?|un-?focus|un-?expand|de-?focus|standard\s*view|back\s*to\s*normal|make\s*it\s*normal|restore(?:\s*it)?)\b/i],
  ["minimize",  /\b(?:minimi[sz]e|collapse\s*(?:it|this|that|the)?)\b/i],
  ["small",     /\b(?:smaller|shrink|make\s*it\s*smaller|compact)\b/i],
  ["large",     /\b(?:larger|bigger|enlarge|make\s*it\s*(?:bigger|larger))\b/i],
];

const WIDGET_NOUN = /\b(widgets?|panels?|windows?|cards?)\b/i;
const COREF = /\b(it|this|that|the (?:one|widget|panel|window|card))\b/i;

// ctx: { focusedWidget: string, openWidgets: [{id, mode}], widgets: [{id, label, re}] }
function detectWidgetControl(text, ctx = {}) {
  const p = String(text || "").trim();
  if (!p || p.length > 90) return null; // real commands are short; skip prose

  let action = null;
  for (const [name, re] of ACTIONS) { if (re.test(p)) { action = name; break; } }
  if (!action) return null;

  const focused = String(ctx.focusedWidget || "").trim().toLowerCase();
  const open = Array.isArray(ctx.openWidgets) ? ctx.openWidgets.filter((w) => w && w.id) : [];
  const widgets = Array.isArray(ctx.widgets) ? ctx.widgets : [];

  const named = widgets.find((w) => w.re && w.re.test(p)) || null;
  const hasNoun = WIDGET_NOUN.test(p);
  const hasCoref = COREF.test(p);

  // Resolve the target widget.
  let targetId = null;
  if (named) targetId = named.id;
  else if (hasCoref && focused) targetId = focused;
  else if (hasNoun && focused) targetId = focused;
  else if (action === "normalize") {
    // "normal view" with no explicit target -> the widget that's actually expanded, if unambiguous.
    if (focused) targetId = focused;
    else {
      const expanded = open.filter((w) => w.mode === "expanded");
      if (expanded.length === 1) targetId = expanded[0].id;
    }
  }

  // Strict gate: resize (small/large) is too ambiguous on a bare coreference, so it needs a named
  // widget or an explicit widget noun. normalize/minimize may use a focused coreference.
  const resizeClass = action === "small" || action === "large";
  const hasSignal = Boolean(named) || hasNoun || (hasCoref && Boolean(focused))
    || (action === "normalize" && Boolean(targetId));
  if (!hasSignal || !targetId) return null;
  if (resizeClass && !named && !hasNoun) return null;

  // The target must actually be open — you can't normalize/resize a window that isn't there.
  if (open.length && !open.some((w) => w.id === targetId)) return null;

  const label = (widgets.find((w) => w.id === targetId) || {}).label || targetId;
  const size = action === "normalize" ? "medium" : action === "minimize" ? "minimize" : action;
  const say = action === "normalize" ? `Back to normal view, sir.`
    : action === "minimize" ? `Minimized the ${label} widget, sir.`
    : `Resized the ${label} widget to ${size === "small" ? "small" : "large"}, sir.`;

  return { id: targetId, label, action, size, say, uiAction: { type: "resize-widget", id: targetId, size } };
}

// ── View switching ("my kalshi positions", "switch kalshi to fills", "show specialists") ──────
// Emits a set-view uiAction the frontend already understands (each widget maps the view word to its
// own tab, and kalshi auto-expands). This replaces the old broken path where the brain tried to
// FETCH the data via an API, failed, and just reported the failure instead of showing the widget.
//
// Guarded so it never hijacks a real data QUESTION: "how many positions", "what's it worth" fall to
// the brain. View words are split into hard (fire when the widget is named/inferred) and soft
// (need an explicit show-verb) so a statement like "kalshi is my favorite market" doesn't fire.

const VALUE_Q = /\b(worth|valued?|how much|how many|number of|total|profit|loss|pnl|p&l|balance|gains?|percent|%|average|avg)\b/i;
const SHOW_VERB = /\b(show|open|switch|flip|go\s*to|pull\s*up|see|view|bring\s*up|display|take me to|jump to|what'?s?|whats)\b/i;

const VIEWS = [
  { id: "kalshi",
    hard: /\b(positions?|holdings|orderbook|order\s*book|fills?)\b/i,
    soft: /\b(markets?|trades?|depth|book)\b/i,
    infer: /\b(positions?|holdings|orderbook|order\s*book|fills?)\b/i,
    pick: (p) => /\b(positions?|holdings)\b/i.test(p) ? "positions"
      : /\b(order\s*book|orderbook|depth|book)\b/i.test(p) ? "orderbook"
      : /\b(fills?|trades?)\b/i.test(p) ? "fills" : "markets" },
  { id: "agents",
    hard: /\b(missions?|specialists?)\b/i, soft: /\b(roster|team|tasks?)\b/i,
    infer: /\b(missions?|specialists?)\b/i,
    pick: (p) => /\b(specialists?|roster|team)\b/i.test(p) ? "specialists" : "missions" },
  { id: "connections",
    hard: /\b(disconnected|offline)\b/i, soft: /\b(connected|online|healthy)\b/i,
    infer: null,
    pick: (p) => /\b(disconnected|offline)\b/i.test(p) ? "disconnected" : "connected" },
  // Memory: infer:null on purpose — its view words (history/search/system/graph) are too common to
  // safely guess, and "graph" would collide with the separate Graph widget. Requires "memory" named.
  { id: "memory",
    hard: /\b(continuity|timeline|history|sessions?|architecture|structure|schema|explore|search|browse|memories|objects?)\b/i,
    soft: null,
    infer: null,
    pick: (p) => /\b(continuity|timeline|history|sessions?)\b/i.test(p) ? "continuity"
      : /\b(architecture|structure|schema)\b/i.test(p) ? "architecture" : "explore" },
];

function detectWidgetView(text, ctx = {}) {
  const p = String(text || "").trim();
  if (!p || p.length > 90) return null;
  if (VALUE_Q.test(p)) return null; // a data/number question — the brain answers that, not a view switch

  const widgets = Array.isArray(ctx.widgets) ? ctx.widgets : [];
  const named = widgets.find((w) => w.re && w.re.test(p)) || null;
  const showVerb = SHOW_VERB.test(p);

  let owner = null;
  if (named) {
    const o = VIEWS.find((v) => v.id === named.id);
    if (o && (o.hard.test(p) || (o.soft && o.soft.test(p) && showVerb))) owner = o;
  }
  if (!owner && showVerb) owner = VIEWS.find((v) => v.infer && v.infer.test(p)) || null;
  if (!owner) return null;

  const view = owner.pick(p);
  const label = (widgets.find((w) => w.id === owner.id) || {}).label || owner.id;
  return { id: owner.id, view, label, say: `Showing ${view} in the ${label} widget, sir.`, uiAction: { type: "set-view", id: owner.id, view } };
}

// ── Move + arrange ────────────────────────────────────────────────────────────────────────────
// Direct spatial commands the brain used to handle slowly/unreliably. Emit move-widget /
// arrange-widgets uiActions with the exact position/layout vocab the frontend understands.

const MOVE_VERB = /\b(move|drag|put|place|shift|snap|send|slide|reposition|stick|dock|nudge|cent(?:er|re))\b/i;
const ARRANGE_VERB = /\b(arrange|tidy|tile|cascade|stack|organi[sz]e|line\s*up|lay\s*out|clean\s*up)\b/i;
const WIDGET_SURFACE = /\b(widgets?|panels?|windows?|screen|workspace|desktop|everything|the hud|my hud)\b/i;

// Map free text to one of the frontend's position keys, or null.
function parsePosition(s) {
  const t = s.toLowerCase();
  const vert = /\b(top|upper)\b/.test(t) ? "top" : /\b(bottom|lower)\b/.test(t) ? "bottom" : "";
  const horiz = /\bleft\b/.test(t) ? "left" : /\bright\b/.test(t) ? "right" : "";
  if (vert && horiz) return `${vert}-${horiz}`;
  if (/\b(cent(?:er|re)|middle)\b/.test(t)) return "center";
  return vert || horiz || null;
}

function detectWidgetMove(text, ctx = {}) {
  const p = String(text || "").trim();
  if (!p || p.length > 90 || !MOVE_VERB.test(p)) return null;
  const position = parsePosition(p);
  if (!position) return null; // "move on", "send the email" — no spatial target

  const widgets = Array.isArray(ctx.widgets) ? ctx.widgets : [];
  const focused = String(ctx.focusedWidget || "").trim().toLowerCase();
  const open = Array.isArray(ctx.openWidgets) ? ctx.openWidgets.filter((w) => w && w.id) : [];
  const named = widgets.find((w) => w.re && w.re.test(p)) || null;
  const hasNoun = /\b(widgets?|panels?|windows?|cards?)\b/i.test(p);
  const hasCoref = /\b(it|this|that|the (?:one|widget|panel|window|card))\b/i.test(p);
  const isCornerOrCenter = position.includes("-") || position === "center";

  let targetId = null;
  if (named) targetId = named.id;
  else if (hasNoun && focused) targetId = focused;
  // Bare coreference ("move it top-right") is allowed ONLY for a corner/center — a single edge like
  // "right" collides with normal speech ("send it to the right person").
  else if (hasCoref && focused && isCornerOrCenter) targetId = focused;
  if (!targetId) return null;
  if (open.length && !open.some((w) => w.id === targetId) && !named) return null;

  const label = (widgets.find((w) => w.id === targetId) || {}).label || targetId;
  return { id: targetId, position, label, say: `Moved the ${label} widget to the ${position.replace("-", " ")}, sir.`, uiAction: { type: "move-widget", id: targetId, position } };
}

function detectWidgetArrange(text, ctx = {}) {
  const p = String(text || "").trim();
  if (!p || p.length > 90 || !ARRANGE_VERB.test(p)) return null;
  // Must be about the widget surface, or "stack the boxes" / "arrange a meeting" would fire.
  if (!WIDGET_SURFACE.test(p)) return null;
  const layout = /\b(cascade|stack)\b/i.test(p) ? "cascade" : "tile";
  return { layout, say: `Tidied your widgets into a ${layout} layout, sir.`, uiAction: { type: "arrange-widgets", layout } };
}

module.exports = { detectWidgetControl, detectWidgetView, detectWidgetMove, detectWidgetArrange };
