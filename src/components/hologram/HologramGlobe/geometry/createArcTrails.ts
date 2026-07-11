import * as THREE from "three";

export type ArcTrail = {
  geometry: THREE.TubeGeometry;
  opacity: number;
  colorA: string;
  colorB: string;
  speed: number;
  offset: number;
};

export type ArcTrailResult = {
  trails: ArcTrail[];
  nodes: THREE.Vector3[];
};

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const HERO_LATITUDES = [-0.58, -0.46, -0.34, -0.18, 0.04, 0.22, 0.42, 0.58];
const HERO_STARTS = [0.08, 0.32, 0.58, 0.82, 1.04, 1.32, 1.64, 1.92];
const HERO_SPANS = [1.7, 1.48, 1.82, 1.36, 1.62, 1.44, 1.26, 1.08];
const HERO_TILTS = [0.34, -0.28, 0.22, -0.38, 0.31, -0.24, 0.18, -0.2];

export function createArcTrails(radius = 1.18, count = 46, seed = 4401): ArcTrailResult {
  const random = mulberry32(seed);
  const trails: ArcTrail[] = [];
  const nodes: THREE.Vector3[] = [];

  for (let index = 0; index < count; index += 1) {
    const hero = index < HERO_LATITUDES.length;
    const latitude = hero
      ? HERO_LATITUDES[index]
      : THREE.MathUtils.clamp((random() - 0.5) * 1.35, -0.72, 0.72);
    const start = hero ? HERO_STARTS[index] : random() * Math.PI * 2;
    const span = hero ? HERO_SPANS[index] : 0.58 + random() * 1.9;
    const wave = hero ? 0.075 + (index % 3) * 0.018 : 0.018 + random() * 0.07;
    const phase = random() * Math.PI * 2;
    const tiltX = (random() - 0.5) * (hero ? 0.3 : 0.2);
    const tiltZ = hero ? HERO_TILTS[index] : (random() - 0.5) * 0.24;
    const rotation = new THREE.Euler(tiltX, 0, tiltZ);
    const controlPoints: THREE.Vector3[] = [];
    const steps = hero ? 26 : 18;

    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const longitude = start + span * progress;
      const localLatitude =
        latitude +
        Math.sin(progress * Math.PI) * wave +
        Math.sin(progress * Math.PI * 2 + phase) * wave * 0.28;
      const elevatedRadius = radius + 0.008 + Math.sin(progress * Math.PI) * (hero ? 0.024 : 0.014);
      const horizontalRadius = Math.cos(localLatitude) * elevatedRadius;
      const point = new THREE.Vector3(
        Math.cos(longitude) * horizontalRadius,
        Math.sin(localLatitude) * elevatedRadius,
        Math.sin(longitude) * horizontalRadius
      ).applyEuler(rotation);
      controlPoints.push(point);
    }

    const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal", 0.45);
    const geometry = new THREE.TubeGeometry(
      curve,
      hero ? 88 : 56,
      hero ? 0.0037 : 0.0022 + random() * 0.0015,
      5,
      false
    );
    trails.push({
      geometry,
      opacity: hero ? 0.38 + random() * 0.18 : 0.085 + random() * 0.16,
      colorA: index % 4 === 0 ? "#1D7EFF" : "#159DFF",
      colorB: index % 5 === 0 ? "#E9FFFF" : "#78DEFF",
      speed: 0.028 + random() * 0.045,
      offset: random()
    });

    if (hero) {
      nodes.push(curve.getPoint(0.15), curve.getPoint(0.54), curve.getPoint(0.9));
    } else if (index % 3 === 0) {
      nodes.push(curve.getPoint(0.3 + random() * 0.42));
    }
  }

  return { trails, nodes: nodes.slice(0, 38) };
}

export function createNodeGeometry(nodes: THREE.Vector3[]) {
  const positions = new Float32Array(nodes.length * 3);
  const normals = new Float32Array(nodes.length * 3);
  const seeds = new Float32Array(nodes.length);
  const sizes = new Float32Array(nodes.length);
  const brightness = new Float32Array(nodes.length);
  const phases = new Float32Array(nodes.length);

  nodes.forEach((node, index) => {
    const normal = node.clone().normalize();
    positions.set(node.toArray(), index * 3);
    normals.set(normal.toArray(), index * 3);
    seeds[index] = ((index * 37) % 101) / 101;
    sizes[index] = index % 7 === 0 ? 1.9 : 1.15 + (index % 4) * 0.12;
    brightness[index] = index % 7 === 0 ? 1.9 : 1.15;
    phases[index] = index * 1.93;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aNormal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aBrightness", new THREE.BufferAttribute(brightness, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  return geometry;
}
