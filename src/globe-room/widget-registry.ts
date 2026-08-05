// The one list of what Jarvis can put on screen.
//
// There were two. `WidgetStrip` held the real registry and `WidgetLauncher` held a hand-copied
// duplicate with a comment saying "same list — no import needed". They were already diverging in
// everything except id and label, and the failure mode is silent: a widget added to one shows up in
// the launcher and opens nothing, or exists and can never be found. One list, imported twice.
//
// `group` and `blurb` exist because seventeen identical rows named "Vision" and "Graph" do not tell
// anyone what those things are. The launcher is the entry point to the whole system; it should read
// like a menu of capabilities, not a list of internal ids.

export interface WidgetDef {
  id: string;
  label: string;
  icon: string;
  group: WidgetGroupKey;
  blurb: string;
}

export type WidgetGroupKey = "system" | "intelligence" | "work" | "personal" | "rooms";

export interface WidgetGroup {
  key: WidgetGroupKey;
  label: string;
  accent: string;
}

// Ordered as they are shown. Accents are how a group is recognised before it is read.
export const WIDGET_GROUPS: WidgetGroup[] = [
  { key: "system",       label: "System",       accent: "#48D8FF" },
  { key: "intelligence", label: "Intelligence", accent: "#8C7BFF" },
  { key: "work",         label: "Work",         accent: "#FFB454" },
  { key: "personal",     label: "Personal",     accent: "#2FE0B0" },
  { key: "rooms",        label: "Rooms",        accent: "#FF6FA5" },
];

export const WIDGETS: WidgetDef[] = [
  { id: "runtime",     label: "Runtime",     icon: "R", group: "system",       blurb: "Live tasks, surfaces and automations" },
  { id: "vitals",      label: "Vitals",      icon: "◍", group: "system",       blurb: "This machine's memory, CPU and disk" },
  { id: "modules",     label: "Modules",     icon: "⬡", group: "system",       blurb: "Capabilities currently loaded" },
  { id: "connections", label: "Connections", icon: "⚡", group: "system",       blurb: "Provider health and API reachability" },
  { id: "devices",     label: "Devices",     icon: "◫", group: "system",       blurb: "Phones and machines paired to the mesh" },
  { id: "trust",       label: "Trust",       icon: "◇", group: "system",       blurb: "Principal, approvals and paired devices" },

  { id: "memory",      label: "Memory",      icon: "◈", group: "intelligence", blurb: "Canonical objects and semantic recall" },
  { id: "graph",       label: "Graph",       icon: "❖", group: "intelligence", blurb: "People, places and threads as a graph" },
  { id: "agents",      label: "Agents",      icon: "◉", group: "intelligence", blurb: "Specialists and the missions they run" },
  { id: "vision",      label: "Vision",      icon: "◎", group: "intelligence", blurb: "What the mesh can currently see" },

  { id: "projects",    label: "Projects",    icon: "◫", group: "work",         blurb: "Repositories Jarvis can reach" },
  { id: "kalshi",      label: "Kalshi",      icon: "▲", group: "work",         blurb: "Balance, positions and tracked markets" },
  { id: "receipts",    label: "Receipts",    icon: "◻", group: "work",         blurb: "Signed record of what Jarvis did" },

  { id: "profile",     label: "Profile",     icon: "◐", group: "personal",     blurb: "Who Jarvis understands you to be" },
  { id: "weather",     label: "Weather",     icon: "☀", group: "personal",     blurb: "Conditions where you are" },

  { id: "helix",       label: "Helix",       icon: "⬡", group: "rooms",        blurb: "Research workspace and evidence" },
  { id: "synapse",     label: "Synapse",     icon: "⬢", group: "rooms",        blurb: "Live session with another Jarvis" },
];

export function accentFor(group: WidgetGroupKey): string {
  return WIDGET_GROUPS.find((item) => item.key === group)?.accent || "#48D8FF";
}

// How well a widget answers what was typed. Lower is better; -1 means it does not.
//
// Searching descriptions as well as names is what makes "paired" find Devices, and it has to stay.
// But without ranking it also meant typing "memory" put Vitals first, because its description reads
// "…memory, CPU and disk" and Vitals happens to come earlier in the registry. Someone who types a
// module's name has already told you which one they want; a description match must never outrank it.
export function scoreQuery(widget: WidgetDef, query: string): number {
  const term = query.trim().toLowerCase();
  if (!term) return 0;
  const label = widget.label.toLowerCase();
  if (label === term) return 0;
  if (label.startsWith(term)) return 1;
  if (label.includes(term)) return 2;
  if (widget.id.includes(term)) return 3;
  if (widget.blurb.toLowerCase().includes(term)) return 4;
  return -1;
}

export function matchesQuery(widget: WidgetDef, query: string): boolean {
  return scoreQuery(widget, query) >= 0;
}

// Best answers first. Ties keep registry order, so the list never reshuffles arbitrarily between
// keystrokes — an unstable sort here makes the thing under the cursor move as you type.
export function rankWidgets(query: string): WidgetDef[] {
  return WIDGETS
    .map((widget, index) => ({ widget, index, score: scoreQuery(widget, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => (a.score - b.score) || (a.index - b.index))
    .map((entry) => entry.widget);
}
