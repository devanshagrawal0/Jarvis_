import * as THREE from "three";

type SphereParticleOptions = {
  count: number;
  radius: number;
  shell?: boolean;
  jitter?: number;
  seed?: number;
};

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  const u = Math.max(0.00001, random());
  const v = Math.max(0.00001, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

function buildGeometry(
  positions: Float32Array,
  normals: Float32Array,
  seeds: Float32Array,
  sizes: Float32Array,
  brightness: Float32Array,
  phases: Float32Array,
  uvs: Float32Array
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aNormal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aBrightness", new THREE.BufferAttribute(brightness, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aUv", new THREE.BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createSphereParticles({
  count,
  radius,
  shell = true,
  jitter = 0.018,
  seed = 1729
}: SphereParticleOptions) {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const phases = new Float32Array(count);
  const uvs = new Float32Array(count * 2);

  for (let index = 0; index < count; index += 1) {
    const zone = random();
    let latitude: number;
    let zoneBoost = 1;

    if (shell && zone < 0.18) {
      latitude = -0.48 + gaussian(random) * 0.1;
      zoneBoost = 1.16;
    } else if (shell && zone < 0.31) {
      latitude = 0.42 + gaussian(random) * 0.13;
      zoneBoost = 1.08;
    } else if (shell && zone < 0.41) {
      latitude = gaussian(random) * 0.11;
      zoneBoost = 1.03;
    } else {
      latitude = Math.asin(2 * random() - 1);
    }

    latitude = THREE.MathUtils.clamp(latitude, -Math.PI / 2, Math.PI / 2);
    const longitude = random() * Math.PI * 2;
    const normal = new THREE.Vector3(
      Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(longitude)
    );

    const pointRadius = shell
      ? radius + (random() - 0.5) * jitter * 2
      : radius * (0.18 + Math.pow(random(), 0.52) * 0.78);
    const point = normal.clone().multiplyScalar(pointRadius);
    const rareHotspot = random() > 0.994;

    positions.set(point.toArray(), index * 3);
    normals.set(normal.toArray(), index * 3);
    seeds[index] = random();
    sizes[index] = shell
      ? (rareHotspot ? 1.8 + random() * 0.6 : 0.62 + random() * 0.68)
      : 0.55 + random() * 0.8;
    brightness[index] = shell
      ? (rareHotspot ? 2.8 : (0.38 + Math.pow(random(), 1.45) * 0.74) * zoneBoost)
      : 0.18 + Math.pow(random(), 2.1) * 0.5;
    phases[index] = random() * Math.PI * 2;
    uvs[index * 2] = longitude / (Math.PI * 2);
    uvs[index * 2 + 1] = latitude / Math.PI + 0.5;
  }

  return buildGeometry(positions, normals, seeds, sizes, brightness, phases, uvs);
}

export function createCityParticles(
  image: CanvasImageSource,
  radius: number,
  maxCount = 2400
) {
  const source = image as { width?: number; height?: number };
  if (
    typeof document === "undefined"
    || !source.width
    || !source.height
  ) {
    return new THREE.BufferGeometry();
  }

  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return new THREE.BufferGeometry();
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const random = mulberry32(421337);
  const candidates: Array<{
    u: number;
    v: number;
    importance: number;
    tier: number;
    tieBreak: number;
  }> = [];

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const ordinary = pixels[offset] / 255;
      const major = pixels[offset + 1] / 255;
      const special = pixels[offset + 2] / 255;
      const importance = ordinary * 0.56 + major * 1.7 + special * 4.8;
      if (importance < 0.035) continue;
      const keepChance = Math.min(1, 0.1 + ordinary * 0.22 + major * 0.78 + special);
      if (random() > keepChance) continue;
      candidates.push({
        u: x / (width - 1),
        v: 1 - y / (height - 1),
        importance,
        tier: special > 0.025 ? 2 : major > 0.045 ? 1 : 0,
        tieBreak: random()
      });
    }
  }

  const quotas = [
    Math.round(maxCount * 0.76),
    Math.round(maxCount * 0.2),
    Math.round(maxCount * 0.04)
  ];
  const selected = [0, 1, 2].flatMap((tier) => candidates
    .filter((candidate) => candidate.tier === tier)
    .sort((a, b) => b.tieBreak - a.tieBreak)
    .slice(0, quotas[tier]));
  const count = selected.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const phases = new Float32Array(count);
  const uvs = new Float32Array(count * 2);

  selected.forEach((candidate, index) => {
    const longitude = candidate.u * Math.PI * 2;
    const latitude = (candidate.v - 0.5) * Math.PI;
    const normal = new THREE.Vector3(
      Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(longitude)
    );
    const point = normal.clone().multiplyScalar(radius * (1.004 + random() * 0.003));
    const energy = THREE.MathUtils.clamp(candidate.importance, 0, 5);
    positions.set(point.toArray(), index * 3);
    normals.set(normal.toArray(), index * 3);
    seeds[index] = THREE.MathUtils.clamp(0.54 + energy * 0.12 + random() * 0.16, 0, 1);
    sizes[index] = 0.94 + Math.pow(energy, 0.68) * 0.66 + random() * 0.36;
    brightness[index] = 0.66 + energy * 0.58;
    phases[index] = random() * Math.PI * 2;
    uvs[index * 2] = candidate.u;
    uvs[index * 2 + 1] = candidate.v;
  });

  return buildGeometry(positions, normals, seeds, sizes, brightness, phases, uvs);
}

export function createAmbientParticles(count: number, seed = 811) {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const phases = new Float32Array(count);
  const uvs = new Float32Array(count * 2);

  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 1.65 + Math.pow(random(), 1.2) * 4.5;
    const height = -1.2 + random() * 4.6;
    const point = new THREE.Vector3(
      Math.cos(angle) * distance,
      height,
      Math.sin(angle) * distance - 0.6
    );
    const normal = point.clone().normalize();
    positions.set(point.toArray(), index * 3);
    normals.set(normal.toArray(), index * 3);
    seeds[index] = random();
    sizes[index] = 0.42 + random() * 0.92;
    brightness[index] = 0.14 + Math.pow(random(), 2.3) * 0.72;
    phases[index] = random() * Math.PI * 2;
    uvs[index * 2] = 0.5;
    uvs[index * 2 + 1] = 0.5;
  }

  return buildGeometry(positions, normals, seeds, sizes, brightness, phases, uvs);
}
