import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * Three-tier dark pedestal with cyan rim rings, a dashed detail ring, a hot
 * white core disc on top, and a soft additive pool glow on the floor —
 * matching the Blender pedestal in jarvis_ref_v70.
 * Floor at y=0; pedestal occupies y 0..0.62.
 */

const TIERS: Array<{ radius: number; height: number; color: string }> = [
  { radius: 1.42, height: 0.1, color: "#04070C" },
  { radius: 1.22, height: 0.12, color: "#050910" },
  { radius: 1.02, height: 0.28, color: "#060B13" }
];

function ringGeometry(radius: number, dashed: boolean, dashCount = 48) {
  const vertices: number[] = [];
  const segments = 180;
  for (let s = 0; s < segments; s += 1) {
    if (dashed && s % Math.round(segments / dashCount) === 0) continue;
    const a = (s / segments) * Math.PI * 2;
    const b = ((s + 1) / segments) * Math.PI * 2;
    vertices.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(b) * radius, 0, Math.sin(b) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function makeRadialGlowTexture(inner: string, outer: string) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function Pedestal() {
  const tierMaterials = useMemo(
    () => TIERS.map((t) => new THREE.MeshBasicMaterial({ color: t.color, toneMapped: false })),
    []
  );
  const rimMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#5FC6FF",
      transparent: true,
      opacity: 0.85,
      toneMapped: false
    }),
    []
  );
  const dashMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#BDE9FF",
      transparent: true,
      opacity: 0.8,
      toneMapped: false
    }),
    []
  );
  const rims = useMemo(
    () => [
      { geometry: ringGeometry(1.42, false), y: 0.102 },
      { geometry: ringGeometry(1.22, false), y: 0.222 },
      { geometry: ringGeometry(1.02, false), y: 0.505 }
    ],
    []
  );
  const dashRing = useMemo(() => ringGeometry(0.78, true, 40), []);

  const coreTexture = useMemo(
    () => makeRadialGlowTexture("rgba(240, 255, 255, 1)", "rgba(240, 255, 255, 0)"),
    []
  );
  const coreMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({
      map: coreTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    [coreTexture]
  );
  const poolTexture = useMemo(
    () => makeRadialGlowTexture("rgba(38, 130, 210, 0.22)", "rgba(38, 130, 210, 0)"),
    []
  );
  const poolMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({
      map: poolTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    [poolTexture]
  );

  useEffect(() => () => {
    tierMaterials.forEach((m) => m.dispose());
    rimMaterial.dispose();
    dashMaterial.dispose();
    rims.forEach((r) => r.geometry.dispose());
    dashRing.dispose();
    coreTexture.dispose();
    coreMaterial.dispose();
    poolTexture.dispose();
    poolMaterial.dispose();
  }, [tierMaterials, rimMaterial, dashMaterial, rims, dashRing, coreTexture, coreMaterial, poolTexture, poolMaterial]);

  let yCursor = 0;
  return (
    <group>
      {/* floor pool glow under everything */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={poolMaterial} renderOrder={-2}>
        <planeGeometry args={[4.2, 4.2]} />
      </mesh>
      {TIERS.map((tier, index) => {
        const y = yCursor + tier.height / 2;
        yCursor += tier.height;
        return (
          <mesh key={index} position={[0, y, 0]} material={tierMaterials[index]}>
            <cylinderGeometry args={[tier.radius, tier.radius + 0.04, tier.height, 96]} />
          </mesh>
        );
      })}
      {/* top cap */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.502, 0]}>
        <circleGeometry args={[1.02, 96]} />
        <meshBasicMaterial color="#030609" toneMapped={false} />
      </mesh>
      {/* rim light rings */}
      {rims.map((rim, index) => (
        <lineSegments key={index} geometry={rim.geometry} material={rimMaterial} position={[0, rim.y, 0]} />
      ))}
      {/* dashed detail ring on top surface */}
      <lineSegments geometry={dashRing} material={dashMaterial} position={[0, 0.508, 0]} />
      {/* hot white core */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.512, 0]} material={coreMaterial}>
        <planeGeometry args={[0.6, 0.6]} />
      </mesh>
    </group>
  );
}
