import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshLineGeometry, MeshLineMaterial } from "meshline";
import * as THREE from "three";

export type AuthoredCurve = {
  id: string;
  tier: "hero" | "secondary";
  width: number;
  speed: number;
  phase: number;
  points: [number, number, number][];
  nodes: number[];
};

type CurveFile = {
  version: number;
  curves: AuthoredCurve[];
};

function createTrailAlphaTexture() {
  const width = 256;
  const bytes = new Uint8Array(width * 4);
  for (let index = 0; index < width; index += 1) {
    const progress = index / (width - 1);
    const start = THREE.MathUtils.smoothstep(progress, 0, 0.12);
    const end = 1 - THREE.MathUtils.smoothstep(progress, 0.78, 1);
    const energy = Math.max(0, Math.min(1, start * end));
    bytes[index * 4] = 255;
    bytes[index * 4 + 1] = 255;
    bytes[index * 4 + 2] = 255;
    bytes[index * 4 + 3] = Math.round(energy * 255);
  }
  const texture = new THREE.DataTexture(bytes, width, 1, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const alphaTexture = createTrailAlphaTexture();

function HeroTrail({
  curve,
  paused
}: {
  curve: AuthoredCurve;
  paused: boolean;
}) {
  const materialRef = useRef<MeshLineMaterial | null>(null);
  const { size } = useThree();
  const geometry = useMemo(() => {
    const result = new MeshLineGeometry();
    result.setPoints(
      curve.points.map((point) => new THREE.Vector3(...point)),
      (progress) => {
        const taper = Math.sin(Math.PI * THREE.MathUtils.clamp(progress, 0, 1));
        return Math.pow(Math.max(0.04, taper), curve.tier === "hero" ? 0.5 : 0.8);
      }
    );
    return result;
  }, [curve]);
  const traceGeometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(
      curve.points.map((point) => new THREE.Vector3(...point))
    ),
    [curve]
  );
  const traceMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: curve.tier === "hero" ? "#259DCB" : "#0A4C79",
      transparent: true,
      opacity: curve.tier === "hero" ? 0.16 : 0.03,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    [curve.tier]
  );
  const traceLine = useMemo(() => {
    const result = new THREE.Line(traceGeometry, traceMaterial);
    result.renderOrder = 2;
    return result;
  }, [traceGeometry, traceMaterial]);
  const material = useMemo(() => {
    const result = new MeshLineMaterial({
      lineWidth: curve.tier === "hero" ? curve.width * 1.08 : curve.width * 0.72,
      color: curve.tier === "hero" ? "#62D7F7" : "#0C65AA",
      gradient: curve.tier === "hero"
        ? [new THREE.Color("#075AA4"), new THREE.Color("#BEEFFF")]
        : [new THREE.Color("#063967"), new THREE.Color("#159BD4")],
      useGradient: 1,
      opacity: curve.tier === "hero" ? 0.34 : 0.04,
      resolution: new THREE.Vector2(size.width, size.height),
      sizeAttenuation: 1,
      alphaMap: alphaTexture,
      useAlphaMap: 1,
      dashArray: curve.tier === "hero" ? 0.24 : 0.12,
      dashRatio: curve.tier === "hero" ? 0.2 : 0.46,
      dashOffset: -curve.phase,
      useDash: 1,
      repeat: new THREE.Vector2(curve.tier === "hero" ? 2.2 : 3.4, 1)
    });
    result.transparent = true;
    result.depthWrite = false;
    result.depthTest = false;
    result.blending = THREE.AdditiveBlending;
    result.toneMapped = false;
    return result;
  }, [curve, size.height, size.width]);

  materialRef.current = material;

  useFrame((_, delta) => {
    material.resolution.set(size.width, size.height);
    if (!paused) {
      material.dashOffset -= delta * curve.speed;
    }
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
    traceGeometry.dispose();
    traceMaterial.dispose();
  }, [geometry, material, traceGeometry, traceMaterial]);

  return (
    <group>
      <primitive object={traceLine} />
      <mesh geometry={geometry} material={material} renderOrder={3} />
    </group>
  );
}

function SecondaryTraceBatch({ curves }: { curves: AuthoredCurve[] }) {
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    for (const curve of curves) {
      for (let index = 0; index < curve.points.length - 1; index += 1) {
        vertices.push(...curve.points[index], ...curve.points[index + 1]);
      }
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return result;
  }, [curves]);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#0A567C",
      transparent: true,
      opacity: 0.027,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true
    }),
    []
  );
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  return <lineSegments geometry={geometry} material={material} renderOrder={2} />;
}

export function useAuthoredCurves() {
  const [data, setData] = useState<CurveFile | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/hologram/hero-curves.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Curve asset failed: ${response.status}`);
        return response.json() as Promise<CurveFile>;
      })
      .then(setData)
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") console.error(error);
      });
    return () => controller.abort();
  }, []);
  return data;
}

export function getCurveNodes(curves: AuthoredCurve[]) {
  const result: THREE.Vector3[] = [];
  for (const curve of curves) {
    for (const position of curve.nodes) {
      const index = Math.round(position * (curve.points.length - 1));
      result.push(new THREE.Vector3(...curve.points[index]));
    }
  }
  return result;
}

export function AuthoredTrails({
  curves,
  paused
}: {
  curves: AuthoredCurve[];
  paused: boolean;
}) {
  const heroCurves = curves.filter((curve) => curve.tier === "hero");
  const secondaryCurves = curves.filter((curve) => curve.tier === "secondary");
  return (
    <group>
      <SecondaryTraceBatch curves={secondaryCurves} />
      {heroCurves.map((curve) => (
        <HeroTrail key={curve.id} curve={curve} paused={paused} />
      ))}
    </group>
  );
}
