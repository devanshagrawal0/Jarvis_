import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, useTexture } from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  SMAA,
} from "@react-three/postprocessing";
import * as THREE from "three";
import {
  AuthoredTrails,
  getCurveNodes,
  useAuthoredCurves
} from "./AuthoredTrails";
import { createNodeGeometry } from "./geometry/createArcTrails";
import {
  createPedestalDetailGeometry,
  createPedestalRings
} from "./geometry/createPedestalRings";
import {
  createAmbientParticles,
  createCityParticles,
  createSphereParticles
} from "./geometry/createSphereParticles";
import { createFresnelAtmosphereMaterial } from "./materials/FresnelAtmosphereMaterial";
import { createParticleMaterial } from "./materials/ParticleMaterial";
import styles from "./HologramGlobe.module.css";

export type HologramGlobeProps = {
  size?: number;
  rotationSpeed?: number;
  particleDensity?: number;
  glowIntensity?: number;
  showPedestal?: boolean;
  paused?: boolean;
};

type SceneProps = Required<HologramGlobeProps> & {
  showProceduralGlobe: boolean;
};

const VISIBLE_ROUTE_IDS = new Set([
  "hero-01",
  "hero-02",
  "hero-04",
  "hero-07",
  "hero-08",
  "hero-12",
  "hero-19",
  "hero-25",
  "hero-26",
  "hero-31",
  "hero-36",
  "hero-41"
]);
const NODE_ROUTE_IDS = new Set([
  "hero-01",
  "hero-02",
  "hero-04",
  "hero-07",
  "hero-08"
]);
const USE_PROCEDURAL_CANVAS = false;
const BASE_ROTATION_SPEED = 0.038;
const LOOP_DURATION_SECONDS = 240 / 24;
const LOOP_MIME_TYPE = 'video/mp4; codecs="avc1.640028"';
const LOOP_INIT_URL = "/hologram/seamless/globe-360-init.mp4";
const LOOP_SEGMENT_URL = "/hologram/seamless/globe-360-loop.m4s";
const LOOP_FALLBACK_URL = "/hologram/jarvis-globe-360-loop.mp4";
const LOOP_POSTER_URL = "/hologram/jarvis-globe-360-poster.png";
const PEDESTAL_SIDE_SLOTS = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2;
  return {
    angle,
    x: Math.cos(angle) * 1.185,
    z: Math.sin(angle) * 1.185,
    width: index % 3 === 0 ? 0.095 : 0.055
  };
});

function createGridGeometry(radius: number) {
  const vertices: number[] = [];
  const segments = 112;

  for (let latitudeIndex = -4; latitudeIndex <= 4; latitudeIndex += 1) {
    const latitude = (latitudeIndex / 5.7) * (Math.PI / 2);
    const ringRadius = Math.cos(latitude) * radius;
    const y = Math.sin(latitude) * radius;
    for (let step = 0; step < segments; step += 1) {
      if ((step + latitudeIndex + 12) % 11 === 0) continue;
      const a = (step / segments) * Math.PI * 2;
      const b = ((step + 1) / segments) * Math.PI * 2;
      vertices.push(
        Math.cos(a) * ringRadius, y, Math.sin(a) * ringRadius,
        Math.cos(b) * ringRadius, y, Math.sin(b) * ringRadius
      );
    }
  }

  for (let longitudeIndex = 0; longitudeIndex < 10; longitudeIndex += 1) {
    const longitude = (longitudeIndex / 10) * Math.PI * 2;
    for (let step = 0; step < 60; step += 1) {
      if ((step + longitudeIndex * 2) % 13 === 0) continue;
      const a = -Math.PI / 2 + (step / 60) * Math.PI;
      const b = -Math.PI / 2 + ((step + 1) / 60) * Math.PI;
      vertices.push(
        Math.cos(a) * Math.cos(longitude) * radius,
        Math.sin(a) * radius,
        Math.cos(a) * Math.sin(longitude) * radius,
        Math.cos(b) * Math.cos(longitude) * radius,
        Math.sin(b) * radius,
        Math.cos(b) * Math.sin(longitude) * radius
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function createFloorGridGeometry() {
  const vertices: number[] = [];
  const extent = 5.4;
  for (let index = -24; index <= 24; index += 1) {
    const position = index * 0.22;
    vertices.push(-extent, 0, position, extent, 0, position);
    vertices.push(position, 0, -extent, position, 0, extent);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function createFloorHudGeometry() {
  const vertices: number[] = [];
  const ringSegments = 128;
  for (const radius of [1.68, 2.05, 2.48, 3.08]) {
    for (let index = 0; index < ringSegments; index += 1) {
      if ((index + Math.round(radius * 10)) % 17 < 3) continue;
      const a = (index / ringSegments) * Math.PI * 2;
      const b = ((index + 1) / ringSegments) * Math.PI * 2;
      vertices.push(
        Math.cos(a) * radius, 0, Math.sin(a) * radius,
        Math.cos(b) * radius, 0, Math.sin(b) * radius
      );
    }
  }
  for (let index = 0; index < 32; index += 1) {
    if (index % 4 === 1) continue;
    const angle = (index / 32) * Math.PI * 2;
    const inner = 1.5 + (index % 3) * 0.08;
    const outer = 2.35 + (index % 5) * 0.16;
    vertices.push(
      Math.cos(angle) * inner, 0, Math.sin(angle) * inner,
      Math.cos(angle) * outer, 0, Math.sin(angle) * outer
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function useAnimatedTime(paused: boolean) {
  const value = useRef(0);
  useFrame((_, delta) => {
    if (!paused) value.current += delta;
  });
  return value;
}

function AtmosphereShell({
  radius,
  glowIntensity,
  paused
}: {
  radius: number;
  glowIntensity: number;
  paused: boolean;
}) {
  const time = useAnimatedTime(paused);
  const breakupMap = useTexture("/hologram/globe-rim-breakup.png");
  breakupMap.colorSpace = THREE.NoColorSpace;
  breakupMap.wrapS = THREE.RepeatWrapping;
  const material = useMemo(
    () => createFresnelAtmosphereMaterial({
      color: "#079CFF",
      accentColor: "#E2FBFF",
      intensity: 0.82 + glowIntensity * 0.22,
      power: 3.8,
      width: 0.42,
      breakupMap
    }),
    [breakupMap, glowIntensity]
  );

  useFrame(() => {
    material.uniforms.uTime.value = time.current;
  });
  useEffect(() => () => {
    material.dispose();
  }, [material]);

  return (
    <mesh scale={1.014} renderOrder={-1}>
      <sphereGeometry args={[radius, 96, 72]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function DarkVolume({ radius }: { radius: number }) {
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color("#00070D") },
        uEdge: { value: new THREE.Color("#0A91C8") },
        uContact: { value: new THREE.Color("#71E3FF") },
        uAmbientFill: { value: new THREE.Color("#021827") },
        uKeyFill: { value: new THREE.Color("#064158") }
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDirection;
        varying vec3 vPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vViewDirection = normalize(cameraPosition - worldPosition.xyz);
          vPosition = position;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCore;
        uniform vec3 uEdge;
        uniform vec3 uContact;
        uniform vec3 uAmbientFill;
        uniform vec3 uKeyFill;
        varying vec3 vNormal;
        varying vec3 vViewDirection;
        varying vec3 vPosition;
        void main() {
          float facing = max(0.0, dot(normalize(vNormal), normalize(vViewDirection)));
          float edge = pow(1.0 - facing, 6.8);
          float contact = pow(1.0 - facing, 14.5);
          vec3 radial = normalize(vPosition);
          vec3 keyDirection = normalize(vec3(-0.72, 0.62, 0.31));
          float key = smoothstep(-0.18, 0.74, dot(radial, keyDirection));
          float crown = smoothstep(0.12, 0.82, radial.y);
          float lowerCatch = smoothstep(-0.96, -0.38, -radial.y);
          float frontFill = pow(
            smoothstep(-0.58, 0.96, dot(radial, normalize(vec3(0.0, 0.04, 1.0)))),
            1.45
          );
          float keyFill = pow(max(0.0, dot(radial, keyDirection)), 1.55);
          float sideFill = pow(
            max(0.0, dot(radial, normalize(vec3(0.68, -0.14, 0.58)))),
            2.15
          );
          float grain = fract(sin(dot(radial.xy, vec2(12.9898, 78.233)) + radial.z * 37.719) * 43758.5453);
          float sideBreakup = (0.38 + 0.62 * smoothstep(0.2, 0.92, grain))
            * (0.76 + 0.24 * sin(radial.y * 34.0 + radial.x * 17.0));
          float directional = clamp(key * 1.2 + crown * 0.12 + lowerCatch * 0.32, 0.0, 1.55);
          vec3 color = uCore;
          color += uAmbientFill * (0.145 + frontFill * 0.25 + lowerCatch * 0.13);
          color += uKeyFill * (keyFill * 0.2 + sideFill * 0.08);
          color += uEdge * edge * (0.035 + key * 0.58 + lowerCatch * 0.31) * sideBreakup;
          color += uContact * contact * directional * 2.65 * sideBreakup;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
      toneMapped: true
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh scale={0.991} renderOrder={-2} material={material}>
      <sphereGeometry args={[radius, 96, 72]} />
    </mesh>
  );
}

function DepthProxy({ radius }: { radius: number }) {
  return (
    <mesh scale={0.968} renderOrder={-20}>
      <sphereGeometry args={[radius, 72, 54]} />
      <meshBasicMaterial
        colorWrite={false}
        depthWrite
        depthTest
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

function ParticleLayer({
  geometry,
  material,
  paused
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  paused: boolean;
}) {
  const time = useAnimatedTime(paused);
  useFrame(({ gl }) => {
    material.uniforms.uTime.value = time.current;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

function SurfaceParticleShell({
  radius,
  density,
  paused
}: {
  radius: number;
  density: number;
  paused: boolean;
}) {
  const count = Math.round(12000 * THREE.MathUtils.clamp(density, 0.35, 1.25));
  const [densityMap, hotspotMap, landMap] = useTexture([
    "/hologram/globe-density.png",
    "/hologram/globe-hotspots.png",
    "/hologram/globe-land-mask.png"
  ]);
  densityMap.colorSpace = THREE.NoColorSpace;
  hotspotMap.colorSpace = THREE.NoColorSpace;
  landMap.colorSpace = THREE.NoColorSpace;
  densityMap.wrapS = THREE.RepeatWrapping;
  hotspotMap.wrapS = THREE.RepeatWrapping;
  landMap.wrapS = THREE.RepeatWrapping;
  const geometry = useMemo(
    () => createSphereParticles({ count, radius, shell: true, jitter: 0.019, seed: 1729 }),
    [count, radius]
  );
  const material = useMemo(
    () => createParticleMaterial({
      colorA: "#087FC4",
      colorB: "#A9EEFF",
      size: 1.18,
      opacity: 0.94,
      intensity: 4.15,
      backOpacity: 0.03,
      pulseStrength: 0.055,
      densityMap,
      hotspotMap,
      landMap,
      useMasks: true
    }),
    [densityMap, hotspotMap, landMap]
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <ParticleLayer geometry={geometry} material={material} paused={paused} />;
}

function InnerParticleCloud({
  radius,
  density,
  paused
}: {
  radius: number;
  density: number;
  paused: boolean;
}) {
  const count = Math.round(820 * THREE.MathUtils.clamp(density, 0.35, 1.4));
  const geometry = useMemo(
    () => createSphereParticles({ count, radius: radius * 0.96, shell: false, seed: 9017 }),
    [count, radius]
  );
  const material = useMemo(
    () => createParticleMaterial({
      colorA: "#0C2342",
      colorB: "#4CBFFF",
      size: 1.22,
      opacity: 0.16,
      intensity: 0.48,
      backOpacity: 1,
      volume: true,
      pulseStrength: 0.11
    }),
    []
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <ParticleLayer geometry={geometry} material={material} paused={paused} />;
}

function CityParticleShell({
  radius,
  paused
}: {
  radius: number;
  paused: boolean;
}) {
  const cityMap = useTexture("/hologram/globe-city-emission.png");
  const geometry = useMemo(
    () => createCityParticles(cityMap.image as CanvasImageSource, radius, 3600),
    [cityMap.image, radius]
  );
  const material = useMemo(
    () => createParticleMaterial({
      colorA: "#159CDE",
      colorB: "#D7F9FF",
      size: 1.12,
      opacity: 0.86,
      intensity: 3.62,
      backOpacity: 0.015,
      pulseStrength: 0.045
    }),
    []
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <ParticleLayer geometry={geometry} material={material} paused={paused} />;
}

function LatLongGrid({ radius }: { radius: number }) {
  const geometry = useMemo(() => createGridGeometry(radius), [radius]);
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#4CBFFF") },
        uOpacity: { value: 0.006 }
      },
      vertexShader: /* glsl */ `
        varying float vFront;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vec3 radialNormal = normalize(mat3(modelMatrix) * normalize(position));
          vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
          vFront = smoothstep(-0.18, 0.62, dot(radialNormal, viewDirection));
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFront;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * mix(0.03, 1.0, vFront));
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <lineSegments geometry={geometry} material={material} />;
}

function GeographicEmissionShell({ radius }: { radius: number }) {
  const [countryMap, cityMap] = useTexture([
    "/hologram/globe-country-map.png",
    "/hologram/globe-city-emission.png"
  ]);
  countryMap.colorSpace = THREE.NoColorSpace;
  cityMap.colorSpace = THREE.NoColorSpace;
  countryMap.wrapS = THREE.RepeatWrapping;
  cityMap.wrapS = THREE.RepeatWrapping;
  countryMap.minFilter = THREE.LinearMipmapLinearFilter;
  cityMap.minFilter = THREE.LinearMipmapLinearFilter;

  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uCountryMap: { value: countryMap },
        uCityMap: { value: cityMap },
        uBorderColor: { value: new THREE.Color("#208FC4") },
        uCityColor: { value: new THREE.Color("#BDEFFF") },
        uSpecialColor: { value: new THREE.Color("#F1FFFF") }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDirection;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vViewDirection = normalize(cameraPosition - worldPosition.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCountryMap;
        uniform sampler2D uCityMap;
        uniform vec3 uBorderColor;
        uniform vec3 uCityColor;
        uniform vec3 uSpecialColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDirection;
        void main() {
          vec3 country = texture2D(uCountryMap, vUv).rgb;
          vec4 city = texture2D(uCityMap, vUv);
          float facing = dot(normalize(vNormal), normalize(vViewDirection));
          float front = smoothstep(-0.06, 0.48, facing);
          float border = country.g;
          float borderGlow = country.b;
          float ordinary = city.r;
          float major = city.g;
          float special = city.b;
          float cityHalo = city.a;
          float cityEnergy = ordinary * 0.56 + major * 1.85 + special * 5.4;
          vec3 color =
            uBorderColor * (border * 0.28 + borderGlow * 0.07)
            + uCityColor * (ordinary * 1.05 + major * 2.4 + cityHalo * 0.25)
            + uSpecialColor * special * 6.2;
          float alpha = front * (
            border * 0.028
            + borderGlow * 0.01
            + cityEnergy * 1.18
            + cityHalo * 0.18
          );
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    [cityMap, countryMap]
  );

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh scale={1.0025} material={material} renderOrder={1}>
      <sphereGeometry args={[radius, 128, 96]} />
    </mesh>
  );
}

function EnergyNodes({
  nodes,
  paused
}: {
  nodes: THREE.Vector3[];
  paused: boolean;
}) {
  const geometry = useMemo(() => createNodeGeometry(nodes), [nodes]);
  const material = useMemo(
    () => createParticleMaterial({
      colorA: "#4CBFFF",
      colorB: "#E9FFFF",
      size: 2.48,
      opacity: 0.9,
      intensity: 5.1,
      backOpacity: 0.025,
      pulseStrength: 0.27
    }),
    []
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <ParticleLayer geometry={geometry} material={material} paused={paused} />;
}

function VerticalBeam({ paused }: { paused: boolean }) {
  const time = useAnimatedTime(paused);
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#4CBFFF") },
        uTime: { value: 0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float horizontal = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 3.6);
          float vertical = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
          float noise = 0.78 + 0.22 * sin(vUv.y * 31.0 - uTime * 0.7 + sin(vUv.y * 9.0));
          float alpha = horizontal * vertical * noise * 0.014;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );

  useFrame(() => {
    material.uniforms.uTime.value = time.current;
  });
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group position={[0, -0.9, 0]}>
      <mesh material={material}>
        <planeGeometry args={[0.12, 0.5, 1, 12]} />
      </mesh>
      <mesh material={material} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.09, 0.5, 1, 12]} />
      </mesh>
    </group>
  );
}

function BackdropLight() {
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#168DD0") }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float horizontal = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 2.6);
          float vertical = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.66, vUv.y);
          gl_FragColor = vec4(uColor, horizontal * vertical * 0.052);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group position={[0, 0.12, -1.2]}>
      <mesh position={[-1.08, 0, 0]} material={material}>
        <planeGeometry args={[0.42, 4.3]} />
      </mesh>
      <mesh position={[1.08, 0, 0]} material={material}>
        <planeGeometry args={[0.42, 4.3]} />
      </mesh>
    </group>
  );
}

function PedestalGlow() {
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#4CBFFF") }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float radius = length(vUv - vec2(0.5)) * 2.0;
          float core = 1.0 - smoothstep(0.0, 0.13, radius);
          float halo = (1.0 - smoothstep(0.04, 1.0, radius)) * 0.52;
          vec3 color = mix(uColor, vec3(0.42, 1.08, 1.34), core);
          gl_FragColor = vec4(color, core * 0.18 + halo * 0.16);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.292, 0]} material={material}>
      <circleGeometry args={[0.72, 96]} />
    </mesh>
  );
}

function PedestalEmissionCard() {
  const texture = useTexture("/hologram/pedestal-emission-card.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return (
    <sprite position={[0, -1.39, 0.28]} scale={[3.7, 1.36, 1]} renderOrder={8}>
      <spriteMaterial
        map={texture}
        color="#D8F8FF"
        transparent
        opacity={0.82}
        depthTest={false}
        depthWrite={false}
        blending={THREE.NormalBlending}
        toneMapped={false}
      />
    </sprite>
  );
}

function PedestalRings({ paused }: { paused: boolean }) {
  const ringRefs = useRef<Array<THREE.Group | null>>([]);
  const rings = useMemo(() => createPedestalRings(), []);
  const detailGeometry = useMemo(createPedestalDetailGeometry, []);

  useFrame((_, delta) => {
    if (paused) return;
    ringRefs.current.forEach((ring, index) => {
      if (ring) ring.rotation.y += rings[index].speed * delta;
    });
  });

  useEffect(() => () => {
    rings.forEach(({ geometry }) => geometry.dispose());
    detailGeometry.dispose();
  }, [detailGeometry, rings]);

  return (
    <group>
      <mesh position={[0, -1.457, 0]}>
        <cylinderGeometry args={[1.16, 1.23, 0.075, 128]} />
        <meshStandardMaterial
          color="#020A10"
          metalness={0.92}
          roughness={0.24}
          emissive="#001725"
          emissiveIntensity={0.025}
        />
      </mesh>
      <mesh position={[0, -1.395, 0]}>
        <cylinderGeometry args={[1.09, 1.16, 0.06, 128]} />
        <meshStandardMaterial
          color="#06151F"
          metalness={0.88}
          roughness={0.34}
          emissive="#00263A"
          emissiveIntensity={0.035}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -1.495, 0]}>
        <torusGeometry args={[1.19, 0.018, 12, 192]} />
        <meshStandardMaterial color="#04111A" metalness={0.94} roughness={0.2} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -1.425, 0]}>
        <torusGeometry args={[1.145, 0.006, 6, 192]} />
        <meshBasicMaterial
          color="#208EC4"
          transparent
          opacity={0.07}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -1.345, 0]}>
        <cylinderGeometry args={[0.98, 1.08, 0.04, 128]} />
        <meshStandardMaterial
          color="#071B27"
          metalness={0.84}
          roughness={0.32}
          emissive="#00344A"
          emissiveIntensity={0.035}
        />
      </mesh>
      <mesh position={[0, -1.312, 0]}>
        <cylinderGeometry args={[0.82, 0.97, 0.026, 128]} />
        <meshStandardMaterial
          color="#082235"
          metalness={0.72}
          roughness={0.3}
          emissive="#00405D"
          emissiveIntensity={0.04}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -1.365, 0]}>
        <torusGeometry args={[1.105, 0.011, 8, 160]} />
        <meshBasicMaterial
          color="#146FAE"
          transparent
          opacity={0.1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -1.3, 0]}>
        <torusGeometry args={[0.8, 0.008, 8, 144]} />
        <meshBasicMaterial
          color="#4CBFFF"
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      <PedestalGlow />
      <group>
        {PEDESTAL_SIDE_SLOTS.map((slot, index) => (
          <mesh
            key={index}
            position={[slot.x, -1.454 + (index % 2) * 0.014, slot.z]}
            rotation={[0, -slot.angle, 0]}
          >
            <boxGeometry args={[slot.width, 0.012, 0.008]} />
            <meshBasicMaterial
              color={index % 4 === 0 ? "#36C8F4" : "#12658F"}
              transparent
              opacity={index % 4 === 0 ? 0.14 : 0.07}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <pointLight color="#44BCF2" intensity={0.28} distance={2.2} decay={2} position={[0, -1.08, 0.4]} />
      <pointLight color="#8DDFFF" intensity={0.16} distance={2.4} decay={2} position={[-1.2, -0.88, 1.15]} />
      <pointLight color="#126CC8" intensity={0.2} distance={2.3} decay={2} position={[1.05, -1.15, 1.05]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.3, 0]}>
        <ringGeometry args={[0.27, 0.58, 96]} />
        <meshBasicMaterial
          color="#1D7EFF"
          transparent
          opacity={0.055}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.304, 0]}>
        <ringGeometry args={[0.62, 0.94, 96]} />
        <meshBasicMaterial
          color="#4CBFFF"
          transparent
          opacity={0.028}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.278, 0]}>
        <circleGeometry args={[0.06, 64]} />
        <meshBasicMaterial
          color="#70C9E7"
          transparent
          opacity={0.24}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.283, 0]}>
        <ringGeometry args={[0.075, 0.25, 96]} />
        <meshBasicMaterial
          color="#BFEFFF"
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      <group position={[0, -1.302, 0]}>
        {rings.map((ring, index) => (
          <group
            key={index}
            ref={(instance) => {
              ringRefs.current[index] = instance;
            }}
            rotation={[0, ring.rotation, 0]}
            position={[0, ring.y, 0]}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]} geometry={ring.geometry}>
              <meshBasicMaterial
                color={ring.color}
                transparent
                opacity={ring.opacity * 0.36}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}
        <lineSegments geometry={detailGeometry} position={[0, 0.028, 0]}>
          <lineBasicMaterial
            color="#29C9FF"
            transparent
            opacity={0.065}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </lineSegments>
      </group>
    </group>
  );
}

function AmbientParticles({
  density,
  paused
}: {
  density: number;
  paused: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const time = useAnimatedTime(paused);
  const count = Math.round(1800 * THREE.MathUtils.clamp(density, 0.4, 1.4));
  const geometry = useMemo(() => createAmbientParticles(count), [count]);
  const material = useMemo(
    () => createParticleMaterial({
      colorA: "#0C2342",
      colorB: "#4CBFFF",
      size: 1.12,
      opacity: 0.36,
      intensity: 0.92,
      backOpacity: 1,
      volume: true,
      pulseStrength: 0.18
    }),
    []
  );

  useFrame(({ gl }, delta) => {
    material.uniforms.uTime.value = time.current;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
    if (!paused && ref.current) {
      ref.current.rotation.y -= delta * 0.009;
      ref.current.position.y += Math.sin(ref.current.rotation.y * 3.1) * delta * 0.002;
    }
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}

function FloorGrid() {
  const geometry = useMemo(createFloorGridGeometry, []);
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#157EAD") },
        uOpacity: { value: 0.05 }
      },
      vertexShader: /* glsl */ `
        varying float vDistance;
        void main() {
          vDistance = length(position.xz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vDistance;
        void main() {
          float fade = 1.0 - smoothstep(0.45, 4.9, vDistance);
          gl_FragColor = vec4(uColor, uOpacity * fade);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <lineSegments
      geometry={geometry}
      material={material}
      position={[0, -1.79, -0.25]}
    />
  );
}

function FloorHud() {
  const geometry = useMemo(createFloorHudGeometry, []);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#1787B8",
      transparent: true,
      opacity: 0.052,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  return (
    <lineSegments
      geometry={geometry}
      material={material}
      position={[0, -1.8, 0]}
      scale={[0.86, 1, 0.86]}
    />
  );
}

function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.82, 0.3]}>
      <planeGeometry args={[12, 12]} />
      <meshStandardMaterial color="#000205" roughness={0.68} metalness={0.28} />
    </mesh>
  );
}

function FloorReflection() {
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#2AAFFF") }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float horizontal = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 4.5);
          float longitudinal = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.36, vUv.y);
          float streak = horizontal * longitudinal;
          gl_FragColor = vec4(uColor * 1.08, streak * 0.11);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -1.79, 1.22]}
      material={material}
    >
      <planeGeometry args={[0.36, 3.6]} />
    </mesh>
  );
}

function PedestalPoolLight() {
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#096B9A") }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float radius = length((vUv - 0.5) * vec2(1.0, 1.18)) * 2.0;
          float pool = 1.0 - smoothstep(0.08, 1.0, radius);
          float centerCut = smoothstep(0.0, 0.32, radius);
          gl_FragColor = vec4(uColor, pool * centerCut * 0.02);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.397, 0.08]} material={material}>
      <circleGeometry args={[1.82, 128]} />
    </mesh>
  );
}

function HologramScene({
  size,
  rotationSpeed,
  particleDensity,
  glowIntensity,
  showPedestal,
  showProceduralGlobe,
  paused
}: SceneProps) {
  const globeFloatRef = useRef<THREE.Group>(null);
  const surfaceRef = useRef<THREE.Group>(null);
  const routeRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const radius = 1.16;
  const surfaceStartY = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("surfaceY");
    const candidate = raw === null ? -1.5 : Number(raw);
    return Number.isFinite(candidate) ? candidate : 0;
  }, []);
  const surfaceStartZ = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("surfaceZ");
    const candidate = raw === null ? -1.2 : Number(raw);
    return Number.isFinite(candidate) ? candidate : 0;
  }, []);
  const routeStartY = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("routeY");
    const candidate = raw === null ? -0.5 : Number(raw);
    return Number.isFinite(candidate) ? candidate : 0;
  }, []);
  const routeStartZ = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("routeZ");
    const candidate = raw === null ? -0.4 : Number(raw);
    return Number.isFinite(candidate) ? candidate : 0;
  }, []);
  const authoredData = useAuthoredCurves();
  const curves = authoredData?.curves ?? [];
  const visibleCurves = useMemo(() => {
    return curves.filter((curve) => VISIBLE_ROUTE_IDS.has(curve.id));
  }, [curves]);
  const nodes = useMemo(
    () => getCurveNodes(visibleCurves.filter((curve) => NODE_ROUTE_IDS.has(curve.id))),
    [visibleCurves]
  );

  useFrame((_, delta) => {
    if (paused) return;
    elapsed.current += delta;
    if (globeFloatRef.current) {
      globeFloatRef.current.position.y = 0.47 + Math.sin(elapsed.current * 0.48) * 0.011;
    }
    if (surfaceRef.current) surfaceRef.current.rotation.y += rotationSpeed * delta;
    if (routeRef.current) routeRef.current.rotation.y += rotationSpeed * delta;
    if (innerRef.current) {
      innerRef.current.rotation.y += rotationSpeed * 0.38 * delta;
      innerRef.current.rotation.x = Math.sin(elapsed.current * 0.17) * 0.028;
    }
  });

  return (
    <>
      <ambientLight color="#09283A" intensity={0.34} />
      <directionalLight color="#C8F5FF" intensity={1.58} position={[-3.5, 5.5, 5]} />
      <directionalLight color="#0876A8" intensity={0.7} position={[4, 0.2, 4]} />
      <Environment resolution={128} background={false}>
        <Lightformer
          form="rect"
          color="#BCEFFF"
          intensity={2.4}
          position={[-3.8, 2.6, 3.6]}
          rotation={[0, 0.55, 0]}
          scale={[3.8, 0.75, 1]}
        />
        <Lightformer
          form="rect"
          color="#087BCE"
          intensity={1.75}
          position={[3.5, 0.5, 2.8]}
          rotation={[0, -0.65, 0]}
          scale={[2.8, 1.2, 1]}
        />
        <Lightformer
          form="ring"
          color="#39C7FF"
          intensity={1.35}
          position={[0, -3.2, 1.2]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[2.5, 2.5, 1]}
        />
      </Environment>
      <AmbientParticles density={particleDensity} paused={paused} />
      {showPedestal && (
        <>
          <ReflectiveFloor />
          <FloorGrid />
          <PedestalPoolLight />
        </>
      )}

      <group scale={size}>
        {showPedestal && (
          <>
            <>
              <group position={[0, 0.08, 0]}>
                <PedestalRings paused={paused} />
              </group>
            </>
          </>
        )}

        {showProceduralGlobe && (
          <group ref={globeFloatRef} position={[0, 0.47, 0]} scale={1.08}>
            <DepthProxy radius={radius} />
            <DarkVolume radius={radius} />
            <AtmosphereShell radius={radius} glowIntensity={glowIntensity} paused={paused} />
            <group ref={surfaceRef} rotation={[0, surfaceStartY, surfaceStartZ]}>
              <SurfaceParticleShell radius={radius} density={particleDensity} paused={paused} />
              <CityParticleShell radius={radius} paused={paused} />
              <GeographicEmissionShell radius={radius} />
            </group>
            <group ref={routeRef} rotation={[0, routeStartY, routeStartZ]}>
              <EnergyNodes nodes={nodes} paused={paused} />
              <AuthoredTrails curves={visibleCurves} paused={paused} />
            </group>
            <group ref={innerRef}>
              <InnerParticleCloud radius={radius} density={particleDensity} paused={paused} />
            </group>
          </group>
        )}
      </group>

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={0.16}
          luminanceThreshold={0.52}
          luminanceSmoothing={0.3}
          kernelSize={3}
        />
        <Bloom
          intensity={1.02 + glowIntensity * 0.34}
          luminanceThreshold={0.69}
          luminanceSmoothing={0.18}
          kernelSize={2}
        />
        <SMAA />
      </EffectComposer>
    </>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function appendToSourceBuffer(
  sourceBuffer: SourceBuffer,
  data: ArrayBuffer,
  timestampOffset?: number
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", handleUpdateEnd);
      sourceBuffer.removeEventListener("error", handleError);
    };
    const handleUpdateEnd = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to append the hologram video segment."));
    };

    sourceBuffer.addEventListener("updateend", handleUpdateEnd, { once: true });
    sourceBuffer.addEventListener("error", handleError, { once: true });
    if (timestampOffset !== undefined) {
      sourceBuffer.timestampOffset = timestampOffset;
    }
    sourceBuffer.appendBuffer(data.slice(0));
  });
}

function ContinuousGlobeVideo({
  paused,
  rotationSpeed
}: {
  paused: boolean;
  rotationSpeed: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedRef = useRef(paused);
  const playbackRate = THREE.MathUtils.clamp(
    rotationSpeed / BASE_ROTATION_SPEED,
    0.2,
    2
  );
  const playbackRateRef = useRef(playbackRate);

  useEffect(() => {
    pausedRef.current = paused;
    playbackRateRef.current = playbackRate;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    if (paused) {
      video.pause();
    } else {
      void video.play().catch(() => {
        // Muted inline playback retries when the media buffer becomes ready.
      });
    }
  }, [paused, playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const abortController = new AbortController();
    let cancelled = false;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let objectUrl: string | null = null;
    let nextSegmentIndex = 0;
    let segmentData: ArrayBuffer | null = null;
    let pumping = false;

    const playWhenAllowed = () => {
      video.playbackRate = playbackRateRef.current;
      if (!pausedRef.current) {
        void video.play().catch(() => {
          // Playback will be retried after the next appended segment.
        });
      }
    };

    const useFallbackLoop = () => {
      if (cancelled) return;
      video.src = LOOP_FALLBACK_URL;
      video.loop = true;
      video.load();
      playWhenAllowed();
    };

    const pumpBuffer = async () => {
      if (
        cancelled
        || pumping
        || !sourceBuffer
        || !segmentData
        || sourceBuffer.updating
      ) {
        return;
      }

      const bufferedEnd = sourceBuffer.buffered.length
        ? sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1)
        : 0;
      if (bufferedEnd - video.currentTime >= LOOP_DURATION_SECONDS * 3) {
        return;
      }

      pumping = true;
      try {
        await appendToSourceBuffer(
          sourceBuffer,
          segmentData,
          nextSegmentIndex * LOOP_DURATION_SECONDS
        );
        nextSegmentIndex += 1;
        playWhenAllowed();
      } catch {
        if (!cancelled) useFallbackLoop();
      } finally {
        pumping = false;
      }
    };

    const setupContinuousStream = async () => {
      if (
        typeof MediaSource === "undefined"
        || !MediaSource.isTypeSupported(LOOP_MIME_TYPE)
      ) {
        useFallbackLoop();
        return;
      }

      try {
        const [initResponse, segmentResponse] = await Promise.all([
          fetch(LOOP_INIT_URL, { signal: abortController.signal }),
          fetch(LOOP_SEGMENT_URL, { signal: abortController.signal })
        ]);
        if (!initResponse.ok || !segmentResponse.ok) {
          throw new Error("Unable to load the continuous hologram stream.");
        }
        const [initData, loadedSegmentData] = await Promise.all([
          initResponse.arrayBuffer(),
          segmentResponse.arrayBuffer()
        ]);
        if (cancelled) return;
        segmentData = loadedSegmentData;

        const openedMediaSource = new MediaSource();
        mediaSource = openedMediaSource;
        objectUrl = URL.createObjectURL(openedMediaSource);
        video.src = objectUrl;
        video.loop = false;

        await new Promise<void>((resolve, reject) => {
          const handleOpen = () => {
            openedMediaSource.removeEventListener("error", handleError);
            resolve();
          };
          const handleError = () => {
            openedMediaSource.removeEventListener("sourceopen", handleOpen);
            reject(new Error("Unable to open the hologram media stream."));
          };
          openedMediaSource.addEventListener("sourceopen", handleOpen, { once: true });
          openedMediaSource.addEventListener("error", handleError, { once: true });
        });
        if (cancelled || openedMediaSource.readyState !== "open") return;

        sourceBuffer = openedMediaSource.addSourceBuffer(LOOP_MIME_TYPE);
        sourceBuffer.mode = "segments";
        await appendToSourceBuffer(sourceBuffer, initData);

        for (let index = 0; index < 4; index += 1) {
          await appendToSourceBuffer(
            sourceBuffer,
            loadedSegmentData,
            index * LOOP_DURATION_SECONDS
          );
          nextSegmentIndex = index + 1;
        }
        if (cancelled) return;

        video.addEventListener("timeupdate", pumpBuffer);
        playWhenAllowed();
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          useFallbackLoop();
        }
      }
    };

    void setupContinuousStream();

    return () => {
      cancelled = true;
      abortController.abort();
      video.removeEventListener("timeupdate", pumpBuffer);
      video.pause();
      if (sourceBuffer?.updating && mediaSource?.readyState === "open") {
        try {
          sourceBuffer.abort();
        } catch {
          // The stream may already be closing.
        }
      }
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className={styles.videoGlobe}
      poster={LOOP_POSTER_URL}
      muted
      playsInline
      preload="auto"
      tabIndex={-1}
      data-playback-core="continuous"
    />
  );
}

export function HologramGlobe({
  size = 1.06,
  rotationSpeed = 0.038,
  particleDensity = 1,
  glowIntensity = 0.65,
  showPedestal = true,
  paused = false
}: HologramGlobeProps) {
  const reducedMotion = useReducedMotion();
  const effectivePaused = paused || reducedMotion;

  return (
    <div className={styles.root}>
      {USE_PROCEDURAL_CANVAS && (
        <Canvas
          className={styles.canvas}
          frameloop={effectivePaused ? "demand" : "always"}
          camera={{ position: [0, 0.28, 7.4], fov: 38, near: 0.1, far: 70 }}
          dpr={[1, 1.25]}
          gl={{
            antialias: false,
            alpha: true,
            powerPreference: "high-performance"
          }}
          onCreated={({ gl, camera }) => {
            gl.setClearColor(0x000000, 0);
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 0.86;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            camera.lookAt(0, -0.25, 0);
          }}
        >
          <HologramScene
            size={size}
            rotationSpeed={rotationSpeed}
            particleDensity={particleDensity}
            glowIntensity={glowIntensity}
            showPedestal={false}
            showProceduralGlobe={false}
            paused={effectivePaused}
          />
        </Canvas>
      )}
      <div className={styles.videoGlobeWrap} aria-hidden="true">
        <ContinuousGlobeVideo
          paused={effectivePaused}
          rotationSpeed={rotationSpeed}
        />
      </div>
    </div>
  );
}
