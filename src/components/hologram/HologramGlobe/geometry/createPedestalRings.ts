import * as THREE from "three";

export type PedestalRing = {
  geometry: THREE.TorusGeometry;
  color: string;
  opacity: number;
  speed: number;
  rotation: number;
  y: number;
};

export function createPedestalRings(): PedestalRing[] {
  return Array.from({ length: 12 }, (_, index) => {
    const radius = 0.18 + index * 0.076;
    const partial = index > 1 && index % 3 !== 0;
    const arc = partial ? Math.PI * (0.5 + (index % 5) * 0.2) : Math.PI * 2;
    return {
      geometry: new THREE.TorusGeometry(radius, index < 2 ? 0.005 : 0.003, 4, 128, arc),
      color: index === 0 ? "#C9F7FF" : index % 2 === 0 ? "#2DB9E8" : "#126AA8",
      opacity: Math.max(0.13, 0.43 - index * 0.022),
      speed: (index % 2 === 0 ? 1 : -1) * (0.025 + index * 0.002),
      rotation: index * 1.37,
      y: (index % 4) * 0.003
    };
  });
}

export function createPedestalDetailGeometry() {
  const vertices: number[] = [];
  const inner = 0.46;
  const outer = 1.16;

  for (let index = 0; index < 40; index += 1) {
    const angle = (index / 40) * Math.PI * 2;
    const longTick = index % 8 === 0;
    const start = longTick ? 0.88 : 1.02;
    const end = longTick ? outer : 1.11;
    vertices.push(
      Math.cos(angle) * start, 0, Math.sin(angle) * start,
      Math.cos(angle) * end, 0, Math.sin(angle) * end
    );
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const start = inner + (index % 3) * 0.055;
    const end = 0.72 + (index % 4) * 0.055;
    vertices.push(
      Math.cos(angle) * start, 0, Math.sin(angle) * start,
      Math.cos(angle) * end, 0, Math.sin(angle) * end
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}
