/* APEX Home v3 — theme + density system.
   Colors live in CSS [data-theme] / [data-density] blocks (apex-home.css);
   this module holds the metadata for the pickers + localStorage persistence.
   The Jarvis mode still drives --ax-acc inline; themes set the structural palette. */

export type ThemeId = "cold" | "midnight" | "contrast";
export type Density = "comfortable" | "compact" | "dense";

export const THEMES: { id: ThemeId; name: string; swatch: string }[] = [
  { id: "cold", name: "Cold Steel", swatch: "#3fd0ff" },
  { id: "midnight", name: "Midnight", swatch: "#a98bff" },
  { id: "contrast", name: "High Contrast", swatch: "#00e5ff" },
];

export const DENSITIES: { id: Density; name: string }[] = [
  { id: "comfortable", name: "Comfortable" },
  { id: "compact", name: "Compact" },
  { id: "dense", name: "Dense" },
];

export const LS_THEME = "apex.home.theme.v1";
export const LS_DENSITY = "apex.home.density.v1";

export function loadPref<T>(k: string, fallback: T): T {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
export function savePref(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
}
