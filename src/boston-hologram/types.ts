export type BuildingFeature = {
  type: "Feature";
  properties: {
    id?: number;
    height?: number;
    use?: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

export type BuildingDatum = {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  glow: number;
};

export type PinTone = "cyan" | "amber" | "green";

export type PinDatum = {
  label: string;
  sublabel: string;
  x: number;
  z: number;
  tone?: PinTone;
};

export type HologramSceneQuality = {
  maxBuildings: number;
  particleCount: number;
  groundDotCount: number;
  dpr: [number, number];
};
