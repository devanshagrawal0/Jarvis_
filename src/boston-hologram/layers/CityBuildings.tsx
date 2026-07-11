import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hologramColors } from "../tokens";
import type { BuildingDatum } from "../types";

export function CityBuildings({ buildings }: { buildings: BuildingDatum[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const edgeRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    if (!meshRef.current || !edgeRef.current || !roofRef.current) return;
    buildings.forEach((building, index) => {
      dummy.position.set(building.x, building.height / 2, building.z);
      dummy.scale.set(building.width, building.height, building.depth);
      dummy.updateMatrix();
      meshRef.current?.setMatrixAt(index, dummy.matrix);
      edgeRef.current?.setMatrixAt(index, dummy.matrix);
      dummy.position.set(building.x, building.height + 0.012, building.z);
      dummy.scale.set(building.width * 0.9, 0.014, building.depth * 0.9);
      dummy.updateMatrix();
      roofRef.current?.setMatrixAt(index, dummy.matrix);
      color.setRGB(0.03 * building.glow, 0.17 * building.glow, 0.35 * building.glow);
      meshRef.current?.setColorAt(index, color);
      color.setRGB(0.04, 0.62 * building.glow, 1.0);
      edgeRef.current?.setColorAt(index, color);
      color.setRGB(0.04, 0.74 * building.glow, 1.0);
      roofRef.current?.setColorAt(index, color);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    edgeRef.current.instanceMatrix.needsUpdate = true;
    roofRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    if (edgeRef.current.instanceColor) edgeRef.current.instanceColor.needsUpdate = true;
    if (roofRef.current.instanceColor) roofRef.current.instanceColor.needsUpdate = true;
  }, [buildings, color, dummy]);

  return (
    <group>
      <instancedMesh ref={meshRef} args={[undefined, undefined, buildings.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={hologramColors.buildingBase}
          emissive={hologramColors.buildingEmission}
          emissiveIntensity={0.12}
          roughness={0.68}
          metalness={0.15}
          transparent
          opacity={0.075}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh ref={edgeRef} args={[undefined, undefined, buildings.length]} frustumCulled={false}>
        <boxGeometry args={[1.014, 1.014, 1.014]} />
        <meshBasicMaterial color={hologramColors.cyan} wireframe transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={roofRef} args={[undefined, undefined, buildings.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={hologramColors.cyan} transparent opacity={0.055} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
