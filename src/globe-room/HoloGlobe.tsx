import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type GeoJson = {
  features: Array<{
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
  }>;
};

function drawCountriesTexture(geo: GeoJson): THREE.CanvasTexture {
  const w = 4096;
  const h = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);

  const project = (lon: number, lat: number): [number, number] => [
    ((lon + 180) / 360) * w,
    ((90 - lat) / 180) * h
  ];

  const tracePolygon = (ring: number[][]) => {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  const eachRing = (cb: (ring: number[][]) => void) => {
    for (const feature of geo.features) {
      const g = feature.geometry;
      if (!g) continue;
      if (g.type === "Polygon") {
        for (const ring of g.coordinates as number[][][]) cb(ring);
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates as number[][][][]) {
          for (const ring of poly) cb(ring);
        }
      }
    }
  };

  ctx.fillStyle = "rgba(10, 42, 64, 0.55)";
  eachRing((ring) => { tracePolygon(ring); ctx.fill(); });

  ctx.strokeStyle = "rgba(64, 176, 255, 0.5)";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  eachRing((ring) => { tracePolygon(ring); ctx.stroke(); });

  ctx.strokeStyle = "rgba(178, 232, 255, 0.95)";
  ctx.lineWidth = 2.2;
  eachRing((ring) => { tracePolygon(ring); ctx.stroke(); });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function useCountriesTexture() {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/globe-room/countries.geojson")
      .then((r) => {
        if (!r.ok) throw new Error("countries.geojson failed to load");
        return r.json() as Promise<GeoJson>;
      })
      .then((geo) => {
        if (cancelled) return;
        setTexture(drawCountriesTexture(geo));
      })
      .catch((error) => {
        console.error("[HoloGlobe]", error);
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => () => { texture?.dispose(); }, [texture]);
  return texture;
}

function createFresnelMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#2FB9FF") },
      uAccent: { value: new THREE.Color("#DBF6FF") }
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - worldPosition.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uAccent;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = max(0.0, dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1.0 - facing, 3.2);
        float hot = pow(1.0 - facing, 7.5);
        vec3 color = uColor * rim * 1.35 + uAccent * hot * 0.9;
        gl_FragColor = vec4(color, rim * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    toneMapped: false
  });
}

function createLatLongGrid(radius: number) {
  const vertices: number[] = [];
  const segments = 96;
  for (const latDeg of [-52, -31, -13, 0, 16, 34, 55]) {
    const lat = (latDeg * Math.PI) / 180;
    const r = Math.cos(lat) * radius;
    const y = Math.sin(lat) * radius;
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      const b = ((s + 1) / segments) * Math.PI * 2;
      vertices.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(b) * r, y, Math.sin(b) * r);
    }
  }
  for (let m = 0; m < 6; m += 1) {
    const lon = (m / 6) * Math.PI;
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      const b = ((s + 1) / segments) * Math.PI * 2;
      vertices.push(
        Math.cos(a) * Math.cos(lon) * radius, Math.sin(a) * radius, Math.cos(a) * Math.sin(lon) * radius,
        Math.cos(b) * Math.cos(lon) * radius, Math.sin(b) * radius, Math.cos(b) * Math.sin(lon) * radius
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

const HALO = "#B3DEFF";

function haloArcGeometry(r: number, a0: number, a1: number, fade: boolean) {
  const vertices: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color(HALO);
  const segments = 96;
  for (let s = 0; s < segments; s += 1) {
    for (const t of [s / segments, (s + 1) / segments]) {
      const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
      vertices.push(r * Math.cos(a), r * Math.sin(a), 0);
      const f = fade ? Math.sin(Math.PI * t) : 1;
      colors.push(c.r * f, c.g * f, c.b * f);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function haloDashGeometry(r: number, a0: number, a1: number, dashes: number) {
  const vertices: number[] = [];
  const segments = dashes * 2;
  for (let s = 0; s < segments; s += 2) {
    const t0 = s / segments;
    const t1 = (s + 0.85) / segments;
    const steps = 6;
    for (let k = 0; k < steps; k += 1) {
      for (const t of [t0 + ((t1 - t0) * k) / steps, t0 + ((t1 - t0) * (k + 1)) / steps]) {
        const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
        vertices.push(r * Math.cos(a), r * Math.sin(a), 0);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geo;
}

function flatArcGeometry(r: number, a0: number, a1: number, fade: boolean) {
  const vertices: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color(HALO);
  const segments = 64;
  for (let s = 0; s < segments; s += 1) {
    for (const t of [s / segments, (s + 1) / segments]) {
      const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
      vertices.push(r * Math.cos(a), 0, -r * Math.sin(a));
      const f = fade ? Math.sin(Math.PI * t) : 1;
      colors.push(c.r * f, c.g * f, c.b * f);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function fullCircleGeometry(r: number) {
  const vertices: number[] = [];
  const segments = 220;
  for (let s = 0; s < segments; s += 1) {
    for (const t of [s / segments, (s + 1) / segments]) {
      const a = t * Math.PI * 2;
      vertices.push(r * Math.cos(a), 0, -r * Math.sin(a));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geo;
}

const DEG = Math.PI / 180;

function OrbitRings(_: { radius: number }) {
  const fadeMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    }),
    []
  );
  const solid = (opacity: number) =>
    new THREE.LineBasicMaterial({
      color: HALO,
      transparent: true,
      opacity,
      toneMapped: false
    });
  const materials = useMemo(
    () => ({
      bright: solid(0.95),
      mid: solid(0.65),
      dim: solid(0.4),
      fade: fadeMaterial
    }),
    [fadeMaterial]
  );

  const geometries = useMemo(
    () => ({
      a1: haloArcGeometry(1.18, 20, 158, false),
      a2: haloDashGeometry(1.328, 95, 175, 12),
      a3: haloArcGeometry(1.328, 10, 60, true),
      a4: haloArcGeometry(1.512, 120, 200, true),
      a5: haloArcGeometry(1.51, -20, 45, false),
      a6: haloArcGeometry(1.685, 150, 195, true),
      a7: haloArcGeometry(1.685, 30, 75, true),
      f1: fullCircleGeometry(1.45),
      f2: fullCircleGeometry(1.712),
      h1l: flatArcGeometry(1.481, 150, 215, true),
      h1r: flatArcGeometry(1.481, -35, 30, true),
      h2l: flatArcGeometry(1.736, 160, 200, true),
      h2r: flatArcGeometry(1.736, -20, 20, true)
    }),
    []
  );

  useEffect(() => () => {
    Object.values(geometries).forEach((g) => g.dispose());
    Object.values(materials).forEach((m) => m.dispose());
  }, [geometries, materials]);

  return (
    <>
      <lineSegments geometry={geometries.a1} material={materials.bright} />
      <lineSegments geometry={geometries.a2} material={materials.mid} />
      <lineSegments geometry={geometries.a3} material={materials.fade} />
      <lineSegments geometry={geometries.a4} material={materials.fade} />
      <lineSegments geometry={geometries.a5} material={materials.bright} />
      <lineSegments geometry={geometries.a6} material={materials.fade} />
      <lineSegments geometry={geometries.a7} material={materials.fade} />
      <group position={[0, 0.18, 0]}>
        <lineSegments geometry={geometries.f1} material={materials.mid} rotation={[14 * DEG, 0, -5 * DEG]} />
        <group position={[0, -0.102, 0]} rotation={[19 * DEG, 0, 4 * DEG]}>
          <lineSegments geometry={geometries.f2} material={materials.dim} />
        </group>
        <lineSegments geometry={geometries.h1l} material={materials.fade} />
        <lineSegments geometry={geometries.h1r} material={materials.fade} />
        <group position={[0, -0.163, 0]}>
          <lineSegments geometry={geometries.h2l} material={materials.fade} />
          <lineSegments geometry={geometries.h2r} material={materials.fade} />
        </group>
      </group>
    </>
  );
}

export function HoloGlobe({
  radius = 1.021,
  centerY = 1.64,
  spinSpeed = 0.16,
  paused = false
}: {
  radius?: number;
  centerY?: number;
  spinSpeed?: number;
  paused?: boolean;
}) {
  const spinRef = useRef<THREE.Group>(null);
  const countries = useCountriesTexture();

  const darkMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#020A12", toneMapped: false }),
    []
  );
  const mapMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      toneMapped: false,
      depthWrite: false
    });
    return mat;
  }, []);
  useEffect(() => {
    if (countries) {
      mapMaterial.map = countries;
      mapMaterial.needsUpdate = true;
    }
  }, [countries, mapMaterial]);

  const fresnel = useMemo(() => createFresnelMaterial(), []);
  const gridGeometry = useMemo(() => createLatLongGrid(radius * 1.004), [radius]);
  const gridMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#1E4E74",
      transparent: true,
      opacity: 0.36,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => {
    darkMaterial.dispose();
    mapMaterial.dispose();
    fresnel.dispose();
    gridGeometry.dispose();
    gridMaterial.dispose();
  }, [darkMaterial, mapMaterial, fresnel, gridGeometry, gridMaterial]);

  useFrame((_, delta) => {
    if (paused) return;
    if (spinRef.current) spinRef.current.rotation.y += spinSpeed * delta;
  });

  return (
    <group position={[0, centerY, 0]}>
      <group position={[0, -0.15, 0]}>
        <mesh material={darkMaterial}>
          <sphereGeometry args={[radius * 0.995, 96, 72]} />
        </mesh>
        <group ref={spinRef}>
          {countries && (
            <mesh material={mapMaterial}>
              <sphereGeometry args={[radius, 96, 72]} />
            </mesh>
          )}
          <lineSegments geometry={gridGeometry} material={gridMaterial} />
        </group>
        <mesh material={fresnel} scale={1.015}>
          <sphereGeometry args={[radius, 96, 72]} />
        </mesh>
      </group>
      <OrbitRings radius={1.021} />
    </group>
  );
}
