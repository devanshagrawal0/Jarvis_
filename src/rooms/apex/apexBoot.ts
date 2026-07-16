import * as THREE from "three";

// APEX — 3D cinematic loading screen (~5s), premium/institutional. A globe of market nodes assembles
// from scattered points and rotates slowly under thin great-circle arcs — monochrome ice-blue on pure
// black, restrained (no neon). Smooth: the point cloud assembles then only the group rotates; the HUD
// (ApexRoom) is updated imperatively via onProgress, never through per-frame React state.
// Signature: startApexBoot(canvas, onDone, onProgress?) → stop().

const DURATION = 5000; // ms
const N = 1700;        // globe nodes
const R = 11;          // globe radius

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function startApexBoot(canvas: HTMLCanvasElement, onDone: () => void, onProgress?: (t: number) => void): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch { const t = setTimeout(() => { onProgress?.(1); onDone(); }, 200); return () => clearTimeout(t); }
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000104, 1);

  const size = () => ({ w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight });
  let { w, h } = size();
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 200);

  let seed = 20240716;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const group = new THREE.Group();
  scene.add(group);

  // ── globe nodes: Fibonacci sphere targets, scattered starts (assemble animation) ──
  const target = new Float32Array(N * 3), startP = new Float32Array(N * 3);
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963229;
    target[i * 3] = Math.cos(th) * r * R; target[i * 3 + 1] = y * R; target[i * 3 + 2] = Math.sin(th) * r * R;
    const sr = 26 + rnd() * 20, sa = rnd() * 6.283, sb = Math.acos(2 * rnd() - 1);
    startP[i * 3] = Math.sin(sb) * Math.cos(sa) * sr; startP[i * 3 + 1] = Math.cos(sb) * sr; startP[i * 3 + 2] = Math.sin(sb) * Math.sin(sa) * sr;
    positions[i * 3] = startP[i * 3]; positions[i * 3 + 1] = startP[i * 3 + 1]; positions[i * 3 + 2] = startP[i * 3 + 2];
  }
  const pgeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  pgeo.setAttribute("position", posAttr);
  const pmat = new THREE.PointsMaterial({ color: 0xbcdcf0, size: 0.085, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false });
  const nodes = new THREE.Points(pgeo, pmat);
  group.add(nodes);

  // ── thin great-circle arcs between random nodes (static, faint) ──
  const arcSegs: number[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vp = new THREE.Vector3();
  for (let k = 0; k < 90; k++) {
    const i = (rnd() * N) | 0, j = (rnd() * N) | 0; if (i === j) continue;
    va.set(target[i * 3], target[i * 3 + 1], target[i * 3 + 2]);
    vb.set(target[j * 3], target[j * 3 + 1], target[j * 3 + 2]);
    const STEPS = 18; let prev: THREE.Vector3 | null = null;
    for (let s = 0; s <= STEPS; s++) {
      const u = s / STEPS;
      vp.copy(va).lerp(vb, u).normalize().multiplyScalar(R * (1 + 0.12 * Math.sin(u * Math.PI)));
      if (prev) arcSegs.push(prev.x, prev.y, prev.z, vp.x, vp.y, vp.z);
      prev = vp.clone();
    }
  }
  const agEo = new THREE.BufferGeometry();
  agEo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arcSegs), 3));
  const amat = new THREE.LineBasicMaterial({ color: 0x3f86ac, transparent: true, opacity: 0 });
  const arcs = new THREE.LineSegments(agEo, amat);
  group.add(arcs);

  // faint outer halo ring (equator), subtle
  const halo = new THREE.Mesh(new THREE.RingGeometry(R * 1.28, R * 1.30, 128), new THREE.MeshBasicMaterial({ color: 0x2ec7ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  halo.rotation.x = Math.PI / 2; group.add(halo);

  group.rotation.x = 0.32;

  const onResize = () => { const s = size(); w = s.w; h = s.h; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); };
  window.addEventListener("resize", onResize);

  const start = performance.now();
  let raf = 0; let done = false;
  const finish = () => { if (done) return; done = true; onProgress?.(1); try { onDone(); } catch { /* noop */ } };
  if (reduced) { onProgress?.(1); const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  const frame = (now: number) => {
    const t = clamp01((now - start) / DURATION);
    onProgress?.(t);

    // assemble the globe over the first ~62%, then hold
    const a = easeInOut(clamp01(t / 0.62));
    if (a < 1) { for (let i = 0; i < N * 3; i++) positions[i] = startP[i] + (target[i] - startP[i]) * a; posAttr.needsUpdate = true; }
    else if (positions[0] !== target[0]) { positions.set(target); posAttr.needsUpdate = true; }

    // slow cinematic rotation + gentle push-in
    group.rotation.y = t * 0.9;
    const push = easeInOut(t);
    camera.position.set(Math.sin(t * 0.5) * 3, 3.5 - push * 1.5, 42 - push * 12);
    camera.lookAt(0, 0.5, 0);

    // fades
    pmat.opacity = 0.15 + 0.75 * clamp01(t / 0.25);
    amat.opacity = 0.16 * clamp01((t - 0.35) / 0.3);
    (halo.material as THREE.MeshBasicMaterial).opacity = 0.5 * clamp01((t - 0.55) / 0.25);

    renderer.render(scene, camera);
    if (t >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    try {
      pgeo.dispose(); pmat.dispose(); agEo.dispose(); amat.dispose();
      (halo.geometry as THREE.BufferGeometry).dispose(); (halo.material as THREE.Material).dispose();
      renderer.dispose();
    } catch { /* noop */ }
  }
  return () => cleanup();
}
