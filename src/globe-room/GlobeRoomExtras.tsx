import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

/**
 * Room elements ported from the Blender globe-room design (jarvis_ref_v70):
 * - RoomStarfield: sparse star points behind the globe
 * - RoomFloorPool: floor whose grid pools around the pedestal and fades to a
 *   faint ambient wash before the tick arc (radial falloff)
 * - FrontTickArc: front semicircle with survey ticks
 * - SidePanels: two dark chamfered holo-panels flanking the globe
 *
 * Coordinate frame: floor at y=0, globe centered on x=z=0.
 */

/**
 * The actual MilkyWay wall texture from the Blender scene (extracted from
 * jarvis_ref_v70.blend), on a huge plane behind everything. The color
 * multiplier plays the role of Blender's dimmed emission strength.
 */
export function SpaceWall() {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let disposed: THREE.Texture | null = null;
    loader.load("/globe-room/milkyway.jpg", (t) => {
      // Blender reads this texture RAW (non-color): its dark pixel values are
      // linear emission that the Filmic transform lifts into visible clouds.
      t.colorSpace = THREE.NoColorSpace;
      disposed = t;
      setTexture(t);
    });
    return () => {
      disposed?.dispose();
    };
  }, []);
  const material = useMemo(() => {
    if (!texture) return null;
    return new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      depthWrite: false
    });
  }, [texture]);
  useEffect(() => () => material?.dispose(), [material]);
  if (!material) return null;

  // EXACT v61 Room_Rear_Deep_Data_Wall: 34×18 at blender y=4.8,
  // z_b -6.45..11.55 → three z=-4.8, y centered 2.55
  return (
    <mesh position={[0, 2.55, -4.8]} material={material} renderOrder={-10}>
      <planeGeometry args={[34, 18]} />
    </mesh>
  );
}

/**
 * EXACT v70 horizon lights: 3 horizontal bars behind the pedestal
 * (Room_Back_Horizon_Strip_0.34/0.54/0.82): x ±7.9, Blender y=2.9 (three
 * z=-2.9), heights 0.34/0.54/0.82, emission strength 0.05.
 * Plus the bottom angled accent strips (8 per side, strength 0.05).
 */
export function HorizonGlow() {
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    const colors: number[] = [];
    const push = (
      x0: number, y0: number, z0: number,
      x1: number, y1: number, z1: number,
      c: THREE.Color, s: number
    ) => {
      vertices.push(x0, y0, z0, x1, y1, z1);
      colors.push(c.r * s, c.g * s, c.b * s, c.r * s, c.g * s, c.b * s);
    };
    const horizon = new THREE.Color(0.125, 0.725, 0.871);
    const hidden = new THREE.Color(0.141, 0.851, 1.0);
    const dim = new THREE.Color(0.051, 0.525, 0.667);
    const accent = new THREE.Color(0.1, 0.4, 1.0);

    // 3 horizon bars behind the pedestal (x ±6.9, blender y=2.92) str 0.30
    for (const h of [0.34, 0.54, 0.82]) {
      push(-6.9, h, -2.92, 6.9, h, -2.92, horizon, 0.3);
    }
    // bottom angled accents (EXACT v61): 8 per side, from (±8.2, yb) to
    // (±2.1, yb+0.48), yb = -2.95 + 0.18k, z=0.022, str 0.40;
    // pattern: k 0,3,6 "hidden" bright cyan, rest "dim"
    for (let k = 0; k < 8; k += 1) {
      const yb = -2.95 + 0.18 * k;
      const c = k % 3 === 0 ? hidden : dim;
      push(-8.2, 0.022, -yb, -2.1, 0.022, -(yb + 0.48), c, 0.4);
      push(8.2, 0.022, -yb, 2.1, 0.022, -(yb + 0.48), c, 0.4);
    }
    // front accent bars (EXACT v61): x ±6 at blender y=-3.6 (str 1.0)
    // and y=-4.4 (str 0.6), z=0.006
    push(-6, 0.006, 3.6, 6, 0.006, 3.6, accent, 1.0);
    push(-6, 0.006, 4.4, 6, 0.006, 4.4, accent, 0.6);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * EXACT v61 world nebula: on the view direction,
 *   n   = fractal noise(dir × (1,1.6,1) × 2.6, detail 8, roughness 0.62)
 *   t   = clamp(pow(n, 2.4) × 4.5)
 *   col = mix(black, linear(0.10,0.26,0.80), t) × 0.25
 * Rendered on a huge backdrop sphere around the camera.
 */
export function NebulaSky() {
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vDir = normalize(worldPosition.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;

        vec3 hash3(vec3 p) {
          p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                   dot(p, vec3(269.5, 183.3, 246.1)),
                   dot(p, vec3(113.5, 271.9, 124.6)));
          return fract(sin(p) * 43758.5453);
        }
        float vnoise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          float a = hash3(i).x;
          float b = hash3(i + vec3(1, 0, 0)).x;
          float c = hash3(i + vec3(0, 1, 0)).x;
          float d = hash3(i + vec3(1, 1, 0)).x;
          float e = hash3(i + vec3(0, 0, 1)).x;
          float g = hash3(i + vec3(1, 0, 1)).x;
          float h = hash3(i + vec3(0, 1, 1)).x;
          float k = hash3(i + vec3(1, 1, 1)).x;
          return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
                     mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
        }
        float fbm8(vec3 p) {
          float v = 0.0;
          float amp = 1.0;
          float total = 0.0;
          for (int o = 0; o < 8; o += 1) {
            v += amp * vnoise3(p);
            total += amp;
            p *= 2.0;
            amp *= 0.62;   // Blender roughness
          }
          return v / total;
        }

        void main() {
          // Blender world Generated dir: (x_b, y_b, z_b) = (x, -z, y) in three
          vec3 dirB = normalize(vec3(vDir.x, -vDir.z, vDir.y));
          vec3 p = dirB * vec3(1.0, 1.6, 1.0) * 2.6;
          // value-noise fbm has less variance than Blender's Perlin fractal;
          // expand contrast around the mean to match its cloud structure
          float n = clamp(0.5 + (fbm8(p) - 0.5) * 2.6, 0.0, 1.0);
          float t = clamp(pow(n, 2.4) * 4.5, 0.0, 1.0);
          vec3 col = mix(vec3(0.0), vec3(0.10, 0.26, 0.80), t) * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material} renderOrder={-12}>
      <sphereGeometry args={[90, 48, 32]} />
    </mesh>
  );
}

type StarLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
};

/**
 * EXACT v61 Fill_Star planes: flat star sheets at Blender y=4.45 (three
 * z=-4.45), x ±17, heights z_b -6..11.6 (three y):
 *   Bright: 100 stars,  color linear(0.88,0.94,1.00) × 7.0
 *   Mid:    400 stars,  color linear(0.78,0.87,1.00) × 3.0
 *   Dim:   1100 stars,  color linear(0.70,0.80,1.00) × 1.6
 * HDR vertex colors let the bright layer hit the bloom pass like Blender.
 */
function makeStarLayer(
  seed: number,
  count: number,
  size: number,
  color: [number, number, number],
  strength: number
): StarLayer {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3 + 0] = (random() - 0.5) * 34;
    positions[i * 3 + 1] = -6 + random() * 17.6;
    positions[i * 3 + 2] = -4.45;
    const jitter = 0.75 + random() * 0.25;
    colors[i * 3 + 0] = color[0] * strength * jitter;
    colors[i * 3 + 1] = color[1] * strength * jitter;
    colors[i * 3 + 2] = color[2] * strength * jitter;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    sizeAttenuation: true,
    depthWrite: false,
    toneMapped: false
  });
  return { geometry, material };
}

export function RoomStarfield() {
  const layers = useMemo(
    () => [
      makeStarLayer(9001, 100, 0.055, [0.88, 0.94, 1.0], 7.0),   // Fill_Star_Bright
      makeStarLayer(7331, 400, 0.04, [0.78, 0.87, 1.0], 3.0),    // Fill_Star_Mid
      makeStarLayer(1337, 1100, 0.03, [0.7, 0.8, 1.0], 1.6)      // Fill_Star_Dim
    ],
    []
  );
  useEffect(() => () => {
    layers.forEach((l) => {
      l.geometry.dispose();
      l.material.dispose();
    });
  }, [layers]);

  return (
    <>
      {layers.map((layer, i) => (
        <points key={i} geometry={layer.geometry} material={layer.material} />
      ))}
    </>
  );
}

export function RoomFloorPool() {
  // LITERAL transcription of Blender's Floor_PureEmit node graph (v61 — the
  // chosen target):
  //   object coords over the 24 × 18 floor centered at (0, y=0.65)
  //   vertical lines:   fract(xl*34),  line if min(f,1-f) < 0.020
  //   horizontal lines: fract(yl*56),  line if min(f,1-f) < 0.013
  //   center boost   = max((1 - r/0.26)^2.4, 0.02), r = length(local xy)
  //   line emission  = (0.07,0.36,1.0) * 2.6 * centerBoost
  //   wash color     = noise(obj*(3.2,5)) ramp 0.3→0.75:
  //                    (0.004,0.009,0.030) → (0.010,0.052,0.085)
  //   wash emission  = washColor * 0.12   (uniform — no falloff in v61)
  //   pixel = mix(wash, line, gridMask)
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int k = 0; k < 4; k += 1) {
            v += a * vnoise(p);
            p *= 2.0;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          // Blender object coords: local -0.5..0.5 over the 24x18 floor
          // (floor center at three (0, z=-0.65); blender y = -three z)
          float xl = vWorldPos.x / 24.0;
          float yl = (-vWorldPos.z - 0.65) / 18.0;

          // grid mask — exact Blender math chain (LESS_THAN 0.020 / 0.013).
          // Coverage-filtered like Blender's multisampling: a line narrower
          // than a pixel contributes its area fraction instead of vanishing.
          float fx = fract(xl * 34.0);
          float gx = min(fx, 1.0 - fx);
          float fy = fract(yl * 56.0);
          float gy = min(fy, 1.0 - fy);
          float lineX = clamp((0.020 - gx) / max(fwidth(gx), 1e-5), 0.0, 1.0);
          float lineY = clamp((0.013 - gy) / max(fwidth(gy), 1e-5), 0.0, 1.0);
          float grid = max(lineX, lineY);

          // v61 boost: max(|1 - r/0.26|^2.4, 0.02) in object space — EEVEE's
          // Power node uses the absolute base, so the profile is U-shaped:
          // hot at center, dim ring at r=0.26, brightening again outward
          float r = length(vec2(xl, yl));
          float boost = max(pow(abs(1.0 - r / 0.26), 2.4), 0.02);

          // line emission: (0.07,0.36,1.0) * 2.6 * boost
          vec3 lineEmit = vec3(0.07, 0.36, 1.0) * (2.6 * boost);

          // wash emission (noise ramp) * 0.12 uniform
          float n = fbm(vec2(xl * 3.2, yl * 5.0) * 4.0);
          float t = clamp((n - 0.3) / 0.45, 0.0, 1.0);
          vec3 washCol = mix(vec3(0.004, 0.009, 0.030), vec3(0.010, 0.052, 0.085), t);
          vec3 washEmit = washCol * 0.12;

          // raw linear emission, exactly like Blender — the Filmic LUT and
          // output pass handle the rest
          vec3 lin = mix(washEmit, lineEmit, grid);
          gl_FragColor = vec4(lin, 1.0);
        }
      `,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  // v61 floor is 24×18 centered at (0, z=-0.65); the plane is extended
  // toward the camera (pattern repeats seamlessly) so the pulled-back
  // camera never sees past the near edge. Far edge stays at Blender's.
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 2.35]}
      material={material}
      renderOrder={-3}
    >
      <planeGeometry args={[30, 24]} />
    </mesh>
  );
}

/**
 * EXACT port of the v70 floor line objects (all values measured from the
 * .blend). Everything carries the same radial falloff clamp(1-(d-1.2)/1.7)
 * baked into per-vertex colors, so lines die out exactly like Blender:
 *  - 24 cross lines: y = -3.15 + 0.32k, half-length 8.3 shrinking by
 *    0.4566/unit for y>0; k 8-15 "hot" material, rest "perspective"
 *  - 37 depth lines: from (0.34k, -3.8) to (0.1156k, 4.6) — a perspective
 *    fan converging at (0, 8.93); |k|<=2 hot
 *  - 4 ellipses centered (0, 0.06): rx/ry (2.44,1.60)(2.85,1.78)
 *    (3.46,2.03)(4.12,2.31); first two hot
 *  - hot color linear(0.133,0.784,0.918), perspective linear(0.027,0.365,0.470)
 *  - spherical glow overlay 13×12: color linear(0.04,0.42,0.78), (1-1.7ρ)²
 * Blender (x, y) → three (x, -y) on the floor plane.
 */
const HOT = new THREE.Color(0.133, 0.784, 0.918);
const PERSP = new THREE.Color(0.027, 0.365, 0.47);
const LINE_GAIN = 0.18; // EXACT v61 emission strength of the fine lines

// GL lines always rasterize 1px wide; Blender's hairline curves cover less
// than a pixel and dim accordingly. Bake that coverage into vertex colors:
// pixels = curve diameter projected at this distance from the fixed camera.
const CAM = new THREE.Vector3(0, 1.95, 10.6);
const PX_PER_UNIT = 540 / Math.tan((41.11 / 2) * (Math.PI / 180)); // at dist 1

function thicknessAtten(x: number, yB: number, bevel: number) {
  const dist = CAM.distanceTo(new THREE.Vector3(x, 0, -yB));
  const px = (2 * bevel * PX_PER_UNIT) / dist;
  return Math.min(1, px);
}

function polyline(
  points: Array<[number, number]>, chroma: THREE.Color, zLift: number, bevel: number
) {
  // points are Blender floor (x, y); output three (x, zLift, -y) segments
  const vertices: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const [x, yB] of [points[i], points[i + 1]]) {
      vertices.push(x, zLift, -yB);
      const f = thicknessAtten(x, yB, bevel) * LINE_GAIN;
      colors.push(chroma.r * f, chroma.g * f, chroma.b * f);
    }
  }
  return { vertices, colors };
}

function sampledLine(
  x0: number, y0: number, x1: number, y1: number,
  chroma: THREE.Color, zLift: number, bevel: number, steps = 48
) {
  const pts: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return polyline(pts, chroma, zLift, bevel);
}

export function FloorLines() {
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    const colors: number[] = [];
    const push = (part: { vertices: number[]; colors: number[] }) => {
      vertices.push(...part.vertices);
      colors.push(...part.colors);
    };

    // cross lines (bevel: hot 0.0018, perspective 0.0011)
    for (let k = 0; k < 24; k += 1) {
      const y = -3.15 + 0.32 * k;
      const half = 8.3 - 0.4566 * Math.max(0, y);
      const hot = k >= 8 && k <= 15;
      push(sampledLine(-half, y, half, y, hot ? HOT : PERSP, 0.006, hot ? 0.0018 : 0.0011));
    }
    // depth lines (perspective fan; bevel: center 0.0017, outer 0.0010)
    for (let k = -18; k <= 18; k += 1) {
      const hot = Math.abs(k) <= 2;
      push(sampledLine(0.34 * k, -3.8, 0.1156 * k, 4.6, hot ? HOT : PERSP, 0.004, hot ? 0.0017 : 0.001));
    }
    // ellipses (bevel: hot 0.0018, perspective 0.0012)
    const ellipses: Array<[number, number, THREE.Color, number, number]> = [
      [2.44, 1.6, HOT, 0.012, 0.0018],
      [2.85, 1.78, HOT, 0.013, 0.0018],
      [3.46, 2.03, PERSP, 0.014, 0.0012],
      [4.12, 2.31, PERSP, 0.015, 0.0012]
    ];
    for (const [rx, ry, chroma, z, bevel] of ellipses) {
      const pts: Array<[number, number]> = [];
      const segments = 160;
      for (let s = 0; s <= segments; s += 1) {
        const a = (s / segments) * Math.PI * 2;
        pts.push([rx * Math.cos(a), 0.06 + ry * Math.sin(a)]);
      }
      push(polyline(pts, chroma, z, bevel));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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

export function FloorGlowOverlay() {
  // EXACT Floor_Glow_Mat (v61): 13×12 plane at z=0.002.
  //   alpha  = (1.7ρ)²            (transparent at CENTER, rising to the edge)
  //   emit   = (0.04,0.42,0.78) * 0.06   (constant in v61)
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        varying vec3 vWorldPos;
        void main() {
          vLocal = uv - 0.5;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vLocal;
        varying vec3 vWorldPos;
        void main() {
          float rho = length(vLocal) * 1.7;
          float alpha = clamp(rho * rho, 0.0, 1.0);
          vec3 emit = vec3(0.04, 0.42, 0.78) * 0.06;
          gl_FragColor = vec4(emit, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={material} renderOrder={-2}>
      <planeGeometry args={[13, 12]} />
    </mesh>
  );
}

export function FrontTickArc({ radius = 3.135 }: { radius?: number }) {
  const { arcGeometry, tickGeometry } = useMemo(() => {
    // EXACT Blender DeckUI_Arc_main: radius 3.135, 141° front span
    const start = -Math.PI * (70.5 / 180);
    const end = Math.PI * (70.5 / 180);
    const arcVertices: number[] = [];
    const segments = 128;
    for (let i = 0; i < segments; i += 1) {
      const a = start + ((end - start) * i) / segments;
      const b = start + ((end - start) * (i + 1)) / segments;
      arcVertices.push(
        Math.sin(a) * radius, 0, Math.cos(a) * radius,
        Math.sin(b) * radius, 0, Math.cos(b) * radius
      );
    }
    const tickVertices: number[] = [];
    const ticks = 44;
    for (let i = 0; i <= ticks; i += 1) {
      const a = start + ((end - start) * i) / ticks;
      const major = i % 4 === 0;
      const len = major ? 0.17 : 0.09;
      tickVertices.push(
        Math.sin(a) * radius, 0, Math.cos(a) * radius,
        Math.sin(a) * (radius + len), 0, Math.cos(a) * (radius + len)
      );
    }
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.Float32BufferAttribute(arcVertices, 3));
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(tickVertices, 3));
    return { arcGeometry: arcGeo, tickGeometry: tickGeo };
  }, [radius]);
  const arcMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#A8D8F8",
      transparent: true,
      opacity: 0.92,
      toneMapped: false
    }),
    []
  );
  const tickMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#8FC4EE",
      transparent: true,
      opacity: 0.75,
      toneMapped: false
    }),
    []
  );
  useEffect(() => () => {
    arcGeometry.dispose();
    tickGeometry.dispose();
    arcMaterial.dispose();
    tickMaterial.dispose();
  }, [arcGeometry, tickGeometry, arcMaterial, tickMaterial]);

  return (
    <group position={[0, 0.004, 0]}>
      <lineSegments geometry={arcGeometry} material={arcMaterial} />
      <lineSegments geometry={tickGeometry} material={tickMaterial} />
    </group>
  );
}

function PanelShape({ mirrored }: { mirrored: boolean }) {
  const { fillGeometry, borderGeometry } = useMemo(() => {
    // chamfered sci-fi frame, outer-top corner cut + step notch (Blender panel)
    // EXACT Blender Screen_* size: 3.43 × 2.65
    const w = 3.43;
    const h = 2.65;
    const chamfer = 0.34;
    const notch = 0.1;
    const pts: [number, number][] = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2 - chamfer],
      [w / 2 - chamfer, h / 2],
      [w / 2 - chamfer - 0.55, h / 2],
      [w / 2 - chamfer - 0.55 - notch, h / 2 - notch],
      [-w / 2 + 0.42, h / 2 - notch],
      [-w / 2, h / 2 - notch - 0.28]
    ];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const fill = new THREE.ShapeGeometry(shape);
    const borderVertices: number[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      borderVertices.push(ax, ay, 0, bx, by, 0);
    }
    const border = new THREE.BufferGeometry();
    border.setAttribute("position", new THREE.Float32BufferAttribute(borderVertices, 3));
    return { fillGeometry: fill, borderGeometry: border };
  }, []);
  const fillMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: "#0A0E15",
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false
    }),
    []
  );
  const borderMaterial = useMemo(
    () => new THREE.LineBasicMaterial({
      color: "#9CC4E8",
      transparent: true,
      opacity: 0.9,
      toneMapped: false
    }),
    []
  );
  const dotMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#8FD8FF", toneMapped: false }),
    []
  );
  useEffect(() => () => {
    fillGeometry.dispose();
    borderGeometry.dispose();
    fillMaterial.dispose();
    borderMaterial.dispose();
    dotMaterial.dispose();
  }, [fillGeometry, borderGeometry, fillMaterial, borderMaterial, dotMaterial]);

  return (
    <group scale={[mirrored ? -1 : 1, 1, 1]}>
      <mesh geometry={fillGeometry} material={fillMaterial} />
      <lineSegments geometry={borderGeometry} material={borderMaterial} position={[0, 0, 0.004]} />
      {/* indicator dots at the top-OUTER corner (Blender: Screen_*_dot0-2) */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[1.07 + i * 0.14, 1.08, 0.004]} material={dotMaterial}>
          <circleGeometry args={[0.022, 12]} />
        </mesh>
      ))}
    </group>
  );
}

const PANEL_DEG = Math.PI / 180;

export function SidePanels() {
  // EXACT Blender Screen_L/R: loc (±4.85, y=2.4 behind, z=2.3 high),
  // rot: 8° back-tilt, ±18° yaw (outer edge toward camera)
  return (
    <>
      <group position={[-4.85, 2.3, -2.4]} rotation={[0, 18 * PANEL_DEG, 0]}>
        <PanelShape mirrored />
      </group>
      <group position={[4.85, 2.3, -2.4]} rotation={[0, -18 * PANEL_DEG, 0]}>
        <PanelShape mirrored={false} />
      </group>
    </>
  );
}
