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

module.exports = { detectWidgetControl };
