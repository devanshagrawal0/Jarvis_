import React, { useEffect } from "react";
import { Command } from "cmdk";

// ── Helpers re-exported for HelixRoom wire feed ───────────────────────────────

export function wireTypeIcon(type?: string): string {
  switch (type) {
    case "analysis":      return "◈";
    case "lock":          return "⊕";
    case "void":          return "↓";
    case "error":         return "⚠";
    case "system":        return "◎";
    case "contradiction": return "⚡";
    default:              return "·";
  }
}

export function formatWireTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Command palette items ─────────────────────────────────────────────────────

const CMD_GROUPS = [
  {
    heading: "Views",
    items: [
      { label: "Jarvis Chat Panel",   action: "jarvis",              icon: "◎", kbd: "⌘J" },
      { label: "Open Vault",          action: "vault",               icon: "◆", kbd: "⌘V" },
      { label: "Living Brief",        action: "brief",               icon: "◎", kbd: "⌘B" },
      { label: "Oracle Query",        action: "oracle",              icon: "⬡", kbd: "⌘O" },
      { label: "The Forge",           action: "forge",               icon: "⚙", kbd: "⌘F" },
      { label: "Workflow Studio",     action: "workflow",            icon: "⚡", kbd: "⌘W" },
      { label: "Agent Constellation", action: "agents",              icon: "◉", kbd: "⌘A" },
      { label: "Knowledge Reservoir", action: "knowledge",           icon: "◈", kbd: "" },
      { label: "Toggle Heatmap",      action: "heatmap",             icon: "·",  kbd: "⌘H" },
    ],
  },
  {
    heading: "Density",
    items: [
      { label: "Compact view",      action: "density-compact",     icon: "≡", kbd: "" },
      { label: "Comfortable view",  action: "density-comfortable", icon: "≡", kbd: "" },
      { label: "Spacious view",     action: "density-spacious",    icon: "≡", kbd: "" },
    ],
  },
  {
    heading: "Help",
    items: [
      { label: "Keyboard shortcuts", action: "shortcuts", icon: "?", kbd: "?" },
    ],
  },
];

// ── HelixCommandPalette (cmdk-powered) ───────────────────────────────────────

export function HelixCommandPalette({ open, onClose, onAction }: {
  open: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="helix-cmd-overlay" onClick={onClose}>
      <div className="helix-cmd-modal" onClick={e => e.stopPropagation()}>
        <Command className="helix-cmdk-root" label="HELIX Command Palette">
          <div className="helix-cmd-search-row">
            <span className="helix-cmd-search-icon" aria-hidden>⌘</span>
            <Command.Input
              className="helix-cmd-input"
              placeholder="Search actions…"
              autoFocus
            />
          </div>
          <Command.List className="helix-cmd-results">
            <Command.Empty className="helix-cmd-empty">No actions found</Command.Empty>
            {CMD_GROUPS.map(group => (
              <Command.Group key={group.heading} heading={group.heading} className="helix-cmd-group">
                {group.items.map(item => (
                  <Command.Item
                    key={item.action}
                    value={item.kbd ? `${item.label} ${item.kbd}` : item.label}
                    className="helix-cmd-item"
                    onSelect={() => { onAction(item.action); onClose(); }}
                  >
                    <span className="helix-cmd-item-icon" aria-hidden>{item.icon}</span>
                    <span className="helix-cmd-item-label">{item.label}</span>
                    {item.kbd && <kbd className="helix-cmd-item-kbd">{item.kbd}</kbd>}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className="helix-cmd-footer" aria-hidden>
            <kbd>↵</kbd> select &nbsp;
            <kbd>↑↓</kbd> navigate &nbsp;
            <kbd>Esc</kbd> close
          </div>
        </Command>
      </div>
    </div>
  );
}
