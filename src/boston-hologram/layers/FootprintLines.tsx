import { useEffect, useState } from "react";
import * as THREE from "three";
import { bostonDataUrl, hologramColors } from "../tokens";
import type { BuildingFeature } from "../types";
import { lngLatToScene } from "../utils/geo";

type LineSet = {
  roof: Float32Array;
  ground: Float32Array;
  verticals: Float32Array;
};

function ringsForFeature(feature: BuildingFeature): number[][][] {
  if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates[0] as number[][]];
  return (feature.geometry.coordinates as number[][][][])
    .map((polygon) => polygon[0])
    .filter((ring) => ring.length > 2);
}

function pushSegment(target: number[], a: { x: number; z: number }, b: { x: number; z: number }, y: number) {
  target.push(a.x, y, a.z, b.x, y, b.z);
}

function buildLineSets(features: BuildingFeature[]): LineSet {
  const roof: number[] = [];
  const ground: number[] = [];
  const verticals: number[] = [];

  let processed = 0;
  for (const feature of features) {
    if (processed > 2800) break;
    const rings = ringsForFeature(feature);
    const rawHeight = Number(feature.properties.height || 10);
    const height = THREE.MathUtils.clamp((rawHeight > 0 ? rawHeight : 8) / 92, 0.04, 1.9);

    for (const ring of rings) {
      if (ring.length < 4) continue;
      const projected = ring.map(([lon, lat]) => lngLatToScene(lon, lat));
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
      if (maxX - minX > 0.82 || maxZ - minZ > 0.82) continue;

      const step = projected.length > 22 ? 2 : 1;
      for (let i = 0; i < projected.length - 1; i += step) {
        const a = projected[i];
        const b = projected[Math.min(i + step, projected.length - 1)];
        pushSegment(ground, a, b, 0.034);
      }
      processed += 1;
    }
  }

  return {
    roof: new Float32Array(roof),
    ground: new Float32Array(ground),
    verticals: new Float32Array(verticals),
  };
}

export function FootprintLines() {
  const [lines, setLines] = useState<LineSet | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(bostonDataUrl)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setLines(buildLineSets(data.features || []));
      })
      .catch(() => {
        if (!cancelled) setLines(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!lines) return null;

  return (
    <group>
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines.ground, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#0878ff" transparent opacity={0.035} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {lines.roof.length ? <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines.roof, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={hologramColors.cyanHot} transparent opacity={0.055} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments> : null}
      {lines.verticals.length ? <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines.verticals, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={hologramColors.cyan} transparent opacity={0.024} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments> : null}
    </group>
  );
}
