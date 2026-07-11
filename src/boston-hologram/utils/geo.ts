import * as THREE from "three";
import { BOSTON_CENTER, METERS_TO_SCENE_UNITS, sceneQuality } from "../tokens";
import type { BuildingDatum, BuildingFeature } from "../types";

export function lngLatToScene(lon: number, lat: number) {
  const metersX = (lon - BOSTON_CENTER.lon) * 111_320 * Math.cos((BOSTON_CENTER.lat * Math.PI) / 180);
  const metersZ = (lat - BOSTON_CENTER.lat) * 110_540;
  return { x: metersX * METERS_TO_SCENE_UNITS, z: -metersZ * METERS_TO_SCENE_UNITS };
}

export function eachCoordinate(geometry: BuildingFeature["geometry"]) {
  const output: number[][] = [];
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates as number[][][]) output.push(...ring);
  } else {
    for (const polygon of geometry.coordinates as number[][][][]) {
      for (const ring of polygon) output.push(...ring);
    }
  }
  return output;
}

export function normalizeBuildings(features: BuildingFeature[]): BuildingDatum[] {
  const buildings: BuildingDatum[] = [];
  for (const feature of features) {
    const coordinates = eachCoordinate(feature.geometry);
    if (coordinates.length < 3) continue;

    const projected = coordinates.map(([lon, lat]) => lngLatToScene(lon, lat));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const point of projected) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }

    const width = THREE.MathUtils.clamp(maxX - minX, 0.035, 0.62);
    const depth = THREE.MathUtils.clamp(maxZ - minZ, 0.035, 0.62);
    if (width > 0.61 && depth > 0.61) continue;

    const rawHeight = Number(feature.properties.height || 12);
    const height = THREE.MathUtils.clamp((rawHeight > 0 ? rawHeight : 8) / 92, 0.035, 1.92);
    const x = (minX + maxX) / 2;
    const z = (minZ + maxZ) / 2;
    const distance = Math.hypot(x, z);
    const glow = THREE.MathUtils.clamp(1.15 - distance / 16, 0.22, 1);

    buildings.push({
      id: Number(feature.properties.id || buildings.length),
      x,
      z,
      width,
      depth,
      height,
      glow,
    });
  }

  return buildings
    .sort((a, b) => b.glow * b.height - a.glow * a.height)
    .slice(0, sceneQuality.maxBuildings);
}
