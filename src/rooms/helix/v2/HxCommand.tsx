// Wave 2 — power-user spine (companion to CommandPalette.tsx): the `?` keyboard
// cheat-sheet + the density model. All global shortcuts are handled centrally in
// HelixV2; this file owns the reference sheet and density constants.
import React from "react";

export const DENSITIES = ["comfortable", "compact", "ultra"] as const;
export type Density = typeof DENSITIES[number];
export const DENSITY_LABEL: Record<Density, string> = { comfortable: "Comfortable", compact: "Compact", ultra: "Ultra" };

export const SHORTCUTS: { keys: string[]; desc: string; group: string }[] = [
  { keys: ["⌘", "K"], desc: "Command palette — navigate, run actions, search evidence/decisions/artifacts", group: "General" },
  { keys: ["?"], desc: "Toggle this shortcut sheet", group: "General" },
  { keys: ["Esc"], desc: "Close palette / overlays", group: "General" },
  { keys: ["D"], desc: "Cycle density (Comfortable → Compact → Ultra)", group: "View" },
  { keys: ["I"], desc: "Toggle the inspector rail", group: "View" },
  { keys: ["←", "→"], desc: "Browser back / forward — walks surface history", group: "View" },
  { keys: ["G", "H"], desc: "Go to Home", group: "Navigate" },
  { keys: ["G", "P"], desc: "Go to Projects", group: "Navigate" },
  { keys: ["G", "A"], desc: "Go to Ask HELIX", group: "Navigate" },
  { keys: ["G", "E"], desc: "Go to Evidence", group: "Navigate" },
  { keys: ["G", "N"], desc: "Go to Analyze", group: "Navigate" },
  { keys: ["G", "B"], desc: "Go to Build", group: "Navigate" },
  { keys: ["G", "C"], desc: "Go to Command Center", group: "Navigate" },
  { keys: ["G", "X"], desc: "Go to Explore", group: "Navigate" },
  { keys: ["G", "O"], desc: "Go to Observability", group: "Navigate" },
];

export function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const groups = [...new Set(SHORTCUTS.map(s => s.group))];
  return (
    <div className="hxv-cheat-scrim" onClick={onClose}>
      <div className="hxv-cheat" onClick={e => e.stopPropagation()}>
        <div className="hxv-cheat-h"><span className="hxv-cheat-t">Keyboard shortcuts</span><button className="hxv-btn ghost" onClick={onClose}>Close</button></div>
        <div className="hxv-cheat-cols">
          {groups.map(g => (
            <div key={g} className="hxv-cheat-grp">
              <div className="hxv-u" style={{ marginBottom: 8 }}>{g}</div>
              {SHORTCUTS.filter(s => s.group === g).map(s => (
                <div key={s.desc} className="hxv-cheat-row">
                  <span className="hxv-cheat-desc">{s.desc}</span>
                  <span className="hxv-cheat-keys">{s.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
