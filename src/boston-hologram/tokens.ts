import type { HologramSceneQuality } from "./types";

export const BOSTON_CENTER = { lon: -71.0876, lat: 42.3372 };
export const METERS_TO_SCENE_UNITS = 1 / 185;

export const hologramColors = {
  void: "#000810",
  voidDeep: "#00070f",
  haze: "#00101e",
  buildingBase: "#041222",
  buildingEmission: "#003b77",
  cyan: "#22d7f5",
  cyanHot: "#7feaff",
  blue: "#0878ff",
  road: "#00baff",
  amber: "#f0a23a",
  green: "#00e2b1",
  label: "#d4f6ff",
};

export const sceneQuality: HologramSceneQuality = {
  maxBuildings: 6200,
  particleCount: 2400,
  groundDotCount: 5200,
  dpr: [1, 1.65],
};

export const cameraConfig = {
  position: [0.2, 8.2, 12.4] as [number, number, number],
  lookAt: [0.08, -0.16, 1.28] as [number, number, number],
  zoom: 61,
  near: 0.1,
  far: 80,
};

export const bostonDataUrl = "/boston/northeastern-boston-buildings.geojson";
