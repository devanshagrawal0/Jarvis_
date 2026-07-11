import { useMemo } from "react";
import * as THREE from "three";
import { hologramColors } from "../tokens";
import { EmissiveLine } from "../primitives/EmissiveLine";

export function GlowRoads() {
  const roads = useMemo(() => {
    const curves: THREE.CatmullRomCurve3[] = [];
    for (let i = -5; i <= 5; i += 1) {
      curves.push(new THREE.CatmullRomCurve3([
        new THREE.Vector3(-13, 0.038, i * 1.3 + 2.5),
        new THREE.Vector3(-7, 0.045, i * 0.9 + Math.sin(i) * 1.2),
        new THREE.Vector3(-1, 0.05, i * 0.45),
        new THREE.Vector3(6, 0.045, i * 0.85 - 0.7),
        new THREE.Vector3(13, 0.038, i * 1.15 - 1.6),
      ]));
    }
    for (let i = -4; i <= 4; i += 1) {
      curves.push(new THREE.CatmullRomCurve3([
        new THREE.Vector3(i * 1.7 - 2, 0.046, -9),
        new THREE.Vector3(i * 1.2, 0.05, -3.2),
        new THREE.Vector3(i * 0.75 + 0.8, 0.052, 1.4),
        new THREE.Vector3(i * 1.45 + 1.2, 0.044, 9),
      ]));
    }
    for (let i = 0; i < 13; i += 1) {
      const offset = (i - 6) * 0.58;
      curves.push(new THREE.CatmullRomCurve3([
        new THREE.Vector3(-10 + i * 0.2, 0.056, 5.8 + offset * 0.18),
        new THREE.Vector3(-5.5 + offset, 0.06, 4.8 + Math.sin(i) * 0.6),
        new THREE.Vector3(-1.5 + offset * 0.55, 0.062, 4.1 - Math.cos(i) * 0.35),
        new THREE.Vector3(3.8 + offset * 0.3, 0.058, 4.4 + Math.sin(i * 0.7) * 0.8),
        new THREE.Vector3(9.5, 0.052, 5.2 - offset * 0.08),
      ]));
    }
    return curves;
  }, []);

  return (
    <group>
      {roads.map((curve, index) => (
        <EmissiveLine
          key={index}
          curve={curve}
          color={index % 7 === 0 ? hologramColors.amber : hologramColors.road}
          opacity={index >= 20 ? (index % 7 === 0 ? 0.24 : 0.18) : index % 7 === 0 ? 0.42 : 0.34}
          radius={index >= 20 ? 0.006 : index % 5 === 0 ? 0.014 : 0.008}
        />
      ))}
    </group>
  );
}
