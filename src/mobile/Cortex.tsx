import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// CORTEX — the JARVIS phone centrepiece (docs/PHONE_APP_PLAN_v2.md §1, Plan A1).
//
// One THREE.Points with N particles. Every particle carries FOUR target positions as attributes
// (shell / core / ring / globe) and the vertex shader blends between them from a "from" and a "to"
// weight vector, staggered per particle by its seed so a morph ripples through the cloud instead
// of snapping. On top of the blended target a curl-noise field moves each particle every frame.
// Nothing is simulated on the CPU and nothing is re-uploaded — the whole thing is stateless per
// frame, which is what keeps it cheap on a phone: one draw call, one attribute set, no FBOs.
//
// Forms: idle = hollow breathing shell with three loose orbit streams · thinking = dense spinning
// core with two bright rings · speaking = a flat ring whose height is a waveform · globe = the
// JARVIS globe (country outlines from globe-room/countries.geojson) with the halo arcs.

// Idle IS the globe (owner decision 2026-09-15): JARVIS at rest is the slowly turning globe with
// its halo; thinking pulls it into the core, speaking spreads it into the ring, and it re-forms.
export type CortexState = "idle" | "thinking" | "speaking";
export const STATES: CortexState[] = ["idle", "thinking", "speaking"];

const WEIGHTS: Record<CortexState, [number, number, number, number]> = {
  idle: [0, 0, 0, 1], thinking: [0, 1, 0, 0], speaking: [0, 0, 1, 0],
};
// spin (rad/s), noise amplitude, noise speed, brightness
const TUNING: Record<CortexState, { spin: number; amp: number; speed: number; energy: number }> = {
  idle: { spin: 0.16, amp: 0.0, speed: 0.15, energy: 0.75 },
  thinking: { spin: 0.9, amp: 0.03, speed: 1.1, energy: 1.0 },
  speaking: { spin: 0.2, amp: 0.02, speed: 0.6, energy: 0.85 },
};

const VERT = /* glsl */ `
  attribute vec3 aShell; attribute vec3 aCore; attribute vec3 aRing; attribute vec3 aGlobe;
  attribute float aSeed; attribute vec4 aKinds; attribute float aArc;
  uniform vec4 uFrom; uniform vec4 uTo; uniform float uProgress; uniform float uSpin; uniform float uClock; uniform float uScale;
  uniform float uTime; uniform float uAmp; uniform float uAudio; uniform float uSize; uniform float uPixelRatio;
  varying float vSeed; varying float vDepth; varying float vKind; varying float vGlobe;

  // Ashima 3D simplex noise
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  vec3 curl(vec3 p){
    const float e = 0.1;
    float n1 = snoise(p + vec3(0.0, e, 0.0)), n2 = snoise(p - vec3(0.0, e, 0.0));
    float n3 = snoise(p + vec3(0.0, 0.0, e)), n4 = snoise(p - vec3(0.0, 0.0, e));
    float n5 = snoise(p + vec3(e, 0.0, 0.0)), n6 = snoise(p - vec3(e, 0.0, 0.0));
    // three offset fields so x/y/z are not the same noise
    float a = (n1 - n2) - (n3 - n4);
    float b = (n3 - n4) - (n5 - n6);
    float c = (n5 - n6) - (n1 - n2);
    return normalize(vec3(a, b, c) + 1e-5);
  }

  void main() {
    // per-particle staggered morph: seeds start at different times so the change ripples
    float p = smoothstep(aSeed * 0.45, aSeed * 0.45 + 0.55, uProgress);
    vec4 w = mix(uFrom, uTo, p);
    // the halo arcs are alive: each partial arc slides around its own circle at its own pace and
    // direction, the two tilted full rings precess slowly about the globe's axis
    vec3 gb = aGlobe;
    if (aArc >= 0.0) {
      float k = aArc;
      if (k < 1.5) {                                   // full tilted rings: precess about Y
        float a = uClock * (k < 0.5 ? 0.30 : -0.19);
        float c = cos(a), sn0 = sin(a);
        gb = vec3(gb.x * c + gb.z * sn0, gb.y, -gb.x * sn0 + gb.z * c);
      } else {                                         // partial arcs: slide in the XY plane
        float dir = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
        float a = uClock * dir * (0.16 + 0.04 * k);
        float c = cos(a), sn0 = sin(a);
        gb = vec3(gb.x * c - gb.y * sn0, gb.x * sn0 + gb.y * c, gb.z);
      }
    }
    vec3 target = aShell * w.x + aCore * w.y + aRing * w.z + gb * w.w;
    float kind = dot(aKinds, w);                       // 0 dust · 1 line · 2 halo (per form)
    // the globe's halo arcs stay fixed to the camera like the desktop's; everything else spins
    float halo = smoothstep(1.5, 2.0, aKinds.w) * w.w;
    float ang = uSpin * (1.0 - halo);
    float cs = cos(ang), sn = sin(ang);
    target = vec3(target.x * cs + target.z * sn, target.y, -target.x * sn + target.z * cs);
    // the speaking ring carries the waveform: height follows angle + time, scaled by audio
    float ringW = w.z;
    float ringAng = atan(aRing.z, aRing.x);
    target.y += ringW * sin(ringAng * 6.0 + uTime * 5.0) * uAudio * 0.35 * (0.5 + 0.5 * aSeed);
    // the thinking core breathes in and out
    float coreW = w.y;
    target *= 1.0 + coreW * 0.06 * sin(uTime * 2.6);
    // slow, low-frequency curl so the cloud drifts in currents instead of fizzing
    // the curl field is six noise evaluations per particle: skipped entirely when the flow is
    // effectively off (the idle globe), which is most of the app's life on a phone
    vec3 pos = target;
    if (uAmp > 0.004) pos += curl(target * 0.8 + vec3(0.0, uTime * 0.3, 0.0)) * uAmp * (0.5 + aSeed);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;

    // dust (tiny, many), lines (even, medium), halo (thin), stars (rare, bright, dust only)
    float isLine = smoothstep(0.5, 1.0, kind) * (1.0 - smoothstep(1.5, 2.0, kind));
    float isHalo = smoothstep(1.5, 2.0, kind);
    float star = smoothstep(1.01, 1.02, aSeed) * (1.0 - isLine) * (1.0 - isHalo) * (1.0 - w.w);
    float tier = mix(0.3 + aSeed * 0.2, 0.74, isLine);
    tier = mix(tier, 0.6, isHalo) + star * 1.8;
    gl_PointSize = uSize * uPixelRatio * tier * (7.5 / dist) * max(uScale, 0.42);
    // docked (small on screen): most points would fuse into a smear, so only a fraction are kept —
    // the sphere reads as a small lit globe with a rim and a few lines, not a blob
    float keep = clamp(pow(uScale, 1.6) * 1.15 + 0.06, 0.06, 1.0);
    if (aSeed > keep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
    vSeed = aSeed; vKind = kind; vDepth = clamp((8.8 - dist) / 2.6, 0.0, 1.0); vGlobe = w.w;
  }`;

const FRAG = /* glsl */ `
  precision mediump float;
  uniform float uEnergy; uniform vec3 uDim; uniform vec3 uMid; uniform vec3 uBright;
  varying float vSeed; varying float vDepth; varying float vKind; varying float vGlobe;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.08, d);
    float isLine = smoothstep(0.5, 1.0, vKind) * (1.0 - smoothstep(1.5, 2.0, vKind));
    float isHalo = smoothstep(1.5, 2.0, vKind);
    float star = smoothstep(1.01, 1.02, vSeed) * (1.0 - isLine) * (1.0 - isHalo) * (1.0 - vGlobe);
    vec3 col = mix(uDim, uMid, smoothstep(0.0, 0.7, vSeed));
    col = mix(col, mix(uMid, uBright, 0.6), isLine);             // lines are even and ice-bright
    col = mix(col, mix(uMid, uBright, 0.4), isHalo);             // halo arcs: cyan, a step quieter
    col = mix(col, mix(uMid, uBright, 0.7), star);
    col *= 0.75 + uEnergy * 0.6;
    col += uBright * smoothstep(0.2, 0.0, d) * star * uEnergy;    // hot centre only on the stars
    // the far side is dimmer so the body reads as a volume
    float depth = 0.45 + 0.55 * vDepth;
    float alpha = mix(0.42, 0.96, isLine); alpha = mix(alpha, 0.8, isHalo); alpha += star * 0.3;
    gl_FragColor = vec4(col * depth, a * depth * alpha * (0.75 + uEnergy * 0.25));
  }`;

type GeoJson = { features: Array<{ geometry: { type: string; coordinates: any } }> };
function lonLat(lon: number, lat: number, rad: number, out: Float32Array, o: number) {
  const ph = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
  out[o] = -Math.sin(ph) * Math.cos(th) * rad; out[o + 1] = Math.cos(ph) * rad; out[o + 2] = Math.sin(ph) * Math.sin(th) * rad;
}
// ── forms ─────────────────────────────────────────────────────────────────────────────────────
function rand(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function shellForm(n: number, out: Float32Array, kinds: Float32Array, r = rand(1)) {
  const streams = Math.floor(n * 0.08), grid = Math.floor(n * 0.30);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (i < streams) {
      // three thin tilted orbit streams around the body
      const k = i % 3, t = r() * Math.PI * 2, rad = 1.28 + k * 0.09 + (r() - 0.5) * 0.012;
      const x = Math.cos(t) * rad, z = Math.sin(t) * rad, y = (r() - 0.5) * 0.012;
      const tx = [0.42, -0.35, 1.25][k], tz = [0.1, -0.5, 0.2][k];
      const y1 = y * Math.cos(tx) - z * Math.sin(tx), z1 = y * Math.sin(tx) + z * Math.cos(tx);
      out[o] = x * Math.cos(tz) - y1 * Math.sin(tz); out[o + 1] = x * Math.sin(tz) + y1 * Math.cos(tz); out[o + 2] = z1;
      kinds[i] = 2;
      continue;
    }
    if (i < streams + grid) {
      // lat/long lines on the surface — the structure that makes the sphere read as an instrument
      kinds[i] = 1;
      const k = i - streams;
      if (k % 2) { const lat = [-52, -31, -13, 0, 16, 34, 55][k % 7]; lonLat(r() * 360 - 180, lat, 1.0, out, o); }
      else { lonLat((k % 6) * 30 + (r() > 0.5 ? 180 : 0), r() * 180 - 90, 1.0, out, o); }
      continue;
    }
    // the body: a fibonacci sphere, thin skin
    kinds[i] = 0;
    const j = i - streams - grid, m = n - streams - grid;
    const y = 1 - (j / (m - 1)) * 2, rr = Math.sqrt(1 - y * y), th = j * 2.399963;
    const rad = 0.985 + r() * 0.03;
    out[o] = Math.cos(th) * rr * rad; out[o + 1] = y * rad; out[o + 2] = Math.sin(th) * rr * rad;
  }
}

function coreForm(n: number, out: Float32Array, kinds: Float32Array, r = rand(2)) {
  const rings = Math.floor(n * 0.22);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (i < rings) {
      const k = i % 2, t = r() * Math.PI * 2, rad = (k ? 1.0 : 0.78) + (r() - 0.5) * 0.01;
      const x = Math.cos(t) * rad, z = Math.sin(t) * rad, y = (r() - 0.5) * 0.008;
      const tilt = k ? -0.55 : 0.4;
      out[o] = x; out[o + 1] = y * Math.cos(tilt) - z * Math.sin(tilt) * 0.35; out[o + 2] = y * Math.sin(tilt) + z * Math.cos(tilt);
      kinds[i] = 1;
      continue;
    }
    // dense ball, denser toward the centre
    kinds[i] = 0;
    const u = r(), v = r(), w = r();
    const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), rad = Math.pow(w, 0.45) * 0.42;
    out[o] = Math.sin(ph) * Math.cos(th) * rad; out[o + 1] = Math.cos(ph) * rad; out[o + 2] = Math.sin(ph) * Math.sin(th) * rad;
  }
}

function ringForm(n: number, out: Float32Array, kinds: Float32Array, r = rand(3)) {
  for (let i = 0; i < n; i++) {
    const o = i * 3; kinds[i] = 1;
    const t = (i / n) * Math.PI * 2 + r() * 0.01, rad = 1.12 + (r() - 0.5) * 0.12;
    out[o] = Math.cos(t) * rad; out[o + 1] = (r() - 0.5) * 0.05; out[o + 2] = Math.sin(t) * rad;
  }
}

// The JARVIS globe as points: country outlines (resampled along their edges), a sparse lat/long
// grid, and the desktop HoloGlobe's halo arcs at the same radii.
function globeForm(n: number, out: Float32Array, kinds: Float32Array, arcIdx: Float32Array, geo: GeoJson | null, r = rand(4)) {
  arcIdx.fill(-1);
  // Coastlines are walked with a FIXED spacing in surface distance (degrees of arc) so the points
  // form an even chain — picking every Nth vertex of the raw polygons left beads and gaps because
  // the source vertices are anything but evenly spaced. A degree of longitude shrinks toward the
  // poles, so the edge length is measured on the sphere, which also stops the Arctic piling up.
  const outline: number[] = [];
  if (geo) {
    const budget = Math.floor(n * 0.78);
    let total = 0;
    const edgeLen = (x0: number, y0: number, x1: number, y1: number) => Math.hypot((x1 - x0) * Math.cos(((y0 + y1) / 2) * Math.PI / 180), y1 - y0);
    const rings: number[][][] = [];
    for (const f of geo.features) {
      const g = f.geometry; if (!g) continue;
      if (g.type === "Polygon") for (const ring of g.coordinates) rings.push(ring);
      else if (g.type === "MultiPolygon") for (const poly of g.coordinates) for (const ring of poly) rings.push(ring);
    }
    for (const ring of rings) for (let k = 0; k < ring.length - 1; k++) total += edgeLen(ring[k][0], ring[k][1], ring[k + 1][0], ring[k + 1][1]);
    const spacing = total / budget;
    let carry = 0;
    for (const ring of rings) {
      for (let k = 0; k < ring.length - 1; k++) {
        const [x0, y0] = ring[k], [x1, y1] = ring[k + 1];
        const len = edgeLen(x0, y0, x1, y1);
        if (len <= 0) continue;
        let d = carry;
        while (d < len) { const t = d / len; outline.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); d += spacing; }
        carry = d - len;
      }
    }
  }
  const outlineCount = outline.length / 2;
  const nOutline = outlineCount ? Math.min(Math.floor(n * 0.78), outlineCount) : 0;
  const nArcs = Math.floor(n * 0.08);
  const nGrid = Math.floor(n * 0.06);
  let i = 0;
  // outlines: pick evenly across the resampled list so every coast gets coverage
  for (let k = 0; k < nOutline; k++, i++) {
    const idx = Math.floor((k / nOutline) * outlineCount);
    lonLat(outline[idx * 2], outline[idx * 2 + 1], 1.0, out, i * 3); kinds[i] = 1;
  }
  // halo arcs (radii from HoloGlobe.OrbitRings): two full tilted circles + partial arcs
  const arcs: Array<[number, number, number, number, number]> = [ // r, a0, a1, tiltX, tiltZ
    [1.45, 0, 360, 14, -5], [1.712, 0, 360, 19, 4], [1.18, 20, 158, 90, 0], [1.328, 95, 175, 90, 0], [1.512, 120, 200, 90, 0], [1.51, -20, 45, 90, 0], [1.685, 150, 195, 90, 0], [1.685, 30, 75, 90, 0],
  ];
  for (let k = 0; k < nArcs; k++, i++) {
    const a = arcs[k % arcs.length]; const t = (a[1] + (a[2] - a[1]) * r()) * Math.PI / 180;
    let x = Math.cos(t) * a[0], y = 0, z = -Math.sin(t) * a[0];
    if (a[3] === 90) { y = -z; z = 0; } // vertical arcs live in the XY plane like the desktop
    const tx = a[3] === 90 ? 0 : a[3] * Math.PI / 180, tz = a[4] * Math.PI / 180;
    let y1 = y * Math.cos(tx) - z * Math.sin(tx), z1 = y * Math.sin(tx) + z * Math.cos(tx);
    const x2 = x * Math.cos(tz) - y1 * Math.sin(tz), y2 = x * Math.sin(tz) + y1 * Math.cos(tz);
    out[i * 3] = x2; out[i * 3 + 1] = y2 + (a[3] === 90 ? 0 : 0.18); out[i * 3 + 2] = z1; kinds[i] = 2; arcIdx[i] = k % arcs.length;
  }
  for (let k = 0; k < nGrid; k++, i++) {
    kinds[i] = 1;
    if (k % 2) { const lat = [-52, -31, -13, 0, 16, 34, 55][k % 7]; lonLat(r() * 360 - 180, lat, 1.004, out, i * 3); }
    else { const lon = (k % 6) * 30; lonLat(lon + (r() > 0.5 ? 180 : 0), r() * 180 - 90, 1.004, out, i * 3); }
  }
  // whatever is left is faint dust just under the surface so the globe reads as a body
  for (; i < n; i++) {
    kinds[i] = 0;
    const u = r(), v = r(); const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
    out[i * 3] = Math.sin(ph) * Math.cos(th) * 0.985; out[i * 3 + 1] = Math.cos(ph) * 0.985; out[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 0.985;
  }
}

// Where the centrepiece sits on screen: the hero (centre) or the dock slot in the top bar. Given as
// a world-space target; the root group lerps toward it every frame — the same trick as the desktop
// globe dock, nothing is re-created.
export type CortexAnchor = { x: number; y: number; scale: number };

export function Cortex({ count, state, audio = 0, audioRef, geo, anchor }: { count: number; state: CortexState; audio?: number; audioRef?: { current: number }; geo: GeoJson | null; anchor?: CortexAnchor }) {
  const points = useRef<THREE.Points>(null);
  const root = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const shell = new Float32Array(count * 3), core = new Float32Array(count * 3), ring = new Float32Array(count * 3), globe = new Float32Array(count * 3), seed = new Float32Array(count);
    const kShell = new Float32Array(count), kCore = new Float32Array(count), kRing = new Float32Array(count), kGlobe = new Float32Array(count);
    const arcIdx = new Float32Array(count);
    shellForm(count, shell, kShell); coreForm(count, core, kCore); ringForm(count, ring, kRing); globeForm(count, globe, kGlobe, arcIdx, geo);
    g.setAttribute("aArc", new THREE.BufferAttribute(arcIdx, 1));
    // each particle knows what it IS in every form (dust / line / halo), so a coastline point can
    // be a dust point in the shell without a second particle set
    const kinds = new Float32Array(count * 4);
    const r = rand(9);
    for (let i = 0; i < count; i++) { seed[i] = r(); kinds[i * 4] = kShell[i]; kinds[i * 4 + 1] = kCore[i]; kinds[i * 4 + 2] = kRing[i]; kinds[i * 4 + 3] = kGlobe[i]; }
    g.setAttribute("aKinds", new THREE.BufferAttribute(kinds, 4));
    g.setAttribute("position", new THREE.BufferAttribute(shell, 3)); // bounding sphere only; the shader ignores it
    g.setAttribute("aShell", new THREE.BufferAttribute(shell, 3));
    g.setAttribute("aCore", new THREE.BufferAttribute(core, 3));
    g.setAttribute("aRing", new THREE.BufferAttribute(ring, 3));
    g.setAttribute("aGlobe", new THREE.BufferAttribute(globe, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
    return g;
  }, [count, geo]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(() => ({
    uFrom: { value: new THREE.Vector4(0, 0, 0, 1) }, uTo: { value: new THREE.Vector4(0, 0, 0, 1) }, uProgress: { value: 1 }, uSpin: { value: 0 }, uClock: { value: 0 }, uScale: { value: 1 },
    uTime: { value: 0 }, uAmp: { value: TUNING.idle.amp }, uAudio: { value: 0 }, uSize: { value: 2.6 }, uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
    uEnergy: { value: TUNING.idle.energy }, uDim: { value: new THREE.Color("#0e5aa8") }, uMid: { value: new THREE.Color("#1fb6ff") }, uBright: { value: new THREE.Color("#e6fbff") },
  }), [gl]);
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending }), [uniforms]);
  const occluder = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);
  const rimMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color("#2fb9ff") }, uAccent: { value: new THREE.Color("#dbf6ff") }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal; varying vec3 vView;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vNormal = normalize(mat3(modelMatrix) * normal); vView = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uAccent; uniform float uOpacity;
      varying vec3 vNormal; varying vec3 vView;
      void main() { float facing = max(0.0, dot(normalize(vNormal), normalize(vView))); float rim = pow(1.0 - facing, 3.4); float hot = pow(1.0 - facing, 8.0);
        gl_FragColor = vec4(uColor * rim * 1.2 + uAccent * hot * 0.8, rim * 0.8 * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, toneMapped: false,
  }), []);
  useEffect(() => () => rimMaterial.dispose(), [rimMaterial]);
  // occluder radius per form: the shell and globe have a dark body, the core and ring do not
  const OCC = [0.955, 0.0, 0.0, 0.996];
  useEffect(() => () => material.dispose(), [material]);

  // state change → start a morph from the CURRENT blend to the new weights
  const live = useRef({ state, spin: TUNING.idle.spin, amp: TUNING.idle.amp, speed: TUNING.idle.speed, energy: TUNING.idle.energy, noiseT: 0 });
  useEffect(() => {
    const u = uniforms;
    const cur = new THREE.Vector4().lerpVectors(u.uFrom.value, u.uTo.value, u.uProgress.value);
    u.uFrom.value.copy(cur); u.uTo.value.set(...WEIGHTS[state]); u.uProgress.value = 0;
    live.current.state = state;
  }, [state, uniforms]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05), u = uniforms, t = TUNING[live.current.state], L = live.current;
    u.uProgress.value = Math.min(1, u.uProgress.value + d / 0.9);
    L.spin += (t.spin - L.spin) * Math.min(1, d * 3); L.amp += (t.amp - L.amp) * Math.min(1, d * 3);
    L.speed += (t.speed - L.speed) * Math.min(1, d * 3); L.energy += (t.energy - L.energy) * Math.min(1, d * 3);
    L.noiseT += d * L.speed;
    u.uTime.value = L.noiseT; u.uClock.value += d; u.uAmp.value = L.amp; u.uEnergy.value = L.energy;
    const level = audioRef ? audioRef.current : audio;
    u.uAudio.value += (level - u.uAudio.value) * Math.min(1, d * 8);
    u.uSpin.value += d * L.spin;
    if (root.current && anchor) {
      const k = Math.min(1, d * 5);
      root.current.position.x += (anchor.x - root.current.position.x) * k;
      root.current.position.y += (anchor.y - root.current.position.y) * k;
      const sc = root.current.scale.x + (anchor.scale - root.current.scale.x) * k;
      root.current.scale.setScalar(sc); u.uScale.value = sc;
    }
    if (occluder.current) {
      const w = new THREE.Vector4().lerpVectors(u.uFrom.value, u.uTo.value, u.uProgress.value);
      const rad = OCC[0] * w.x + OCC[1] * w.y + OCC[2] * w.z + OCC[3] * w.w;
      occluder.current.scale.setScalar(Math.max(rad, 0.001)); occluder.current.visible = rad > 0.05;
      if (rim.current) { rim.current.visible = w.w > 0.02; rimMaterial.uniforms.uOpacity.value = w.w; rim.current.scale.setScalar(1.012); }
    }
  });

  return (
    <group ref={root}>
      <mesh ref={occluder} renderOrder={0}><sphereGeometry args={[1, 48, 32]} /><meshBasicMaterial color="#02070d" /></mesh>
      <mesh ref={rim} material={rimMaterial} renderOrder={2}><sphereGeometry args={[1, 64, 48]} /></mesh>
      <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
