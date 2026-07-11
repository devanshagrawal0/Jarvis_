import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LeftTab  = "Evidence" | "Contradiction" | "Knowledge" | "Graph";
export type RightTab = "Strategy" | "Risks" | "Scenarios" | "Experiments" | "Synthesis" | "Workflows" | "Relations" | "Agents" | "Signals" | "Journal";

interface HelixUIState {
  leftTab: LeftTab;
  rightTab: RightTab;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  density: "compact" | "comfortable" | "spacious";
  heatMap: boolean;
  panelSplit: number;
  topbarCollapsed: boolean;

  setLeftTab:          (t: LeftTab) => void;
  setRightTab:         (t: RightTab) => void;
  setLeftCollapsed:    (v: boolean | ((x: boolean) => boolean)) => void;
  setRightCollapsed:   (v: boolean | ((x: boolean) => boolean)) => void;
  setDensity:          (d: "compact" | "comfortable" | "spacious" | ((x: "compact" | "comfortable" | "spacious") => "compact" | "comfortable" | "spacious")) => void;
  setHeatMap:          (v: boolean | ((x: boolean) => boolean)) => void;
  setPanelSplit:       (v: number | ((x: number) => number)) => void;
  setTopbarCollapsed:  (v: boolean | ((x: boolean) => boolean)) => void;
}

export const useHelixStore = create<HelixUIState>()(
  persist(
    (set) => ({
      leftTab:          "Evidence",
      rightTab:         "Strategy",
      leftCollapsed:    false,
      rightCollapsed:   false,
      density:          "comfortable",
      heatMap:          false,
      panelSplit:       0.5,
      topbarCollapsed:  false,

      setLeftTab:          (t)  => set({ leftTab: t }),
      setRightTab:         (t)  => set({ rightTab: t }),
      setLeftCollapsed:    (v)  => set(s => ({ leftCollapsed:  typeof v === "function" ? v(s.leftCollapsed)  : v })),
      setRightCollapsed:   (v)  => set(s => ({ rightCollapsed: typeof v === "function" ? v(s.rightCollapsed) : v })),
      setDensity:          (d)  => set(s => ({ density: typeof d === "function" ? d(s.density) : d })),
      setHeatMap:          (v)  => set(s => ({ heatMap: typeof v === "function" ? v(s.heatMap) : v })),
      setPanelSplit:       (v)  => set(s => ({ panelSplit: typeof v === "function" ? v(s.panelSplit) : v })),
      setTopbarCollapsed:  (v)  => set(s => ({ topbarCollapsed: typeof v === "function" ? v(s.topbarCollapsed) : v })),
    }),
    { name: "helix-ui-state" }
  )
);
