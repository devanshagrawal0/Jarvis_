import * as THREE from "three";

// APEX — 3D cinematic loading screen (~5s), night scene. A camera fly-through of a neon "data city":
// green/red candlestick towers on a dark grid plane under a starfield, additive data-stream particles,
// a cyan shockwave. The APEX wordmark + loading HUD are a crisp DOM overlay (see ApexRoom), driven by
// the onProgress callback. Signature: startApexBoot(canvas, onDone, onProgress?) → stop().

const DURATION = 5000; // ms
const GRID = 15;
const SPACING = 3.0;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function startApexBoot(canvas: HTMLCanvasElement, onDone: () => void, onProgress?: (t: number) => void): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch { const t = setTimeout(() => { onProgress?.(1); onDone(); }, 200); return () => clearTimeout(t); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const NIGHT = new THREE.Color(0x000206); // near-black, faint blue — proper night
  renderer.setClearColor(NIGHT, 1);

  const size = () => ({ w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight });
  let { w, h } = size();
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000206, 0.026);
  const camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 400);

  let seed = 20240716;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const half = ((GRID - 1) * SPACING) / 2;

  // ── starfield ──
  const starGeo = new THREE.BufferGeometry();
  const sN = 900, sPos = new Float32Array(sN * 3);
  for (let i = 0; i < sN; i++) { sPos[i * 3] = (rnd() - 0.5) * 360; sPos[i * 3 + 1] = 20 + rnd() * 160; sPos[i * 3 + 2] = -rnd() * 340; }
  starGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0x8fb8d6, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.0, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat); scene.add(stars);

  // ── neon floor grid (dim) ──
  const grid = new THREE.GridHelper(GRID * SPACING * 2, 60, 0x1c6f9c, 0x08202f);
  (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.0;
  scene.add(grid);

  // ── candlestick towers (instanced), bright against the night ──
  const geo = new THREE.BoxGeometry(0.85, 1, 0.85);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, fog: true });
  const count = GRID * GRID;
  const towers = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const cGreen = new THREE.Color(0x1fff9a), cRed = new THREE.Color(0xff556a);
  type TI = { x: number; z: number; base: number; phase: number; speed: number };
  const info: TI[] = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const idx = i * GRID + j;
    info.push({ x: i * SPACING - half, z: j * SPACING - half, base: 2 + rnd() * 15, phase: rnd() * 6.28, speed: 1.5 + rnd() * 3 });
    const up = rnd() > 0.47;
    towers.setColorAt(idx, (up ? cGreen : cRed).clone().multiplyScalar(0.85 + rnd() * 0.5));
  }
  scene.add(towers);

  // ── data-stream particles ──
  const PN = 1100;
  const pgeo = new THREE.BufferGeometry();
  const pos = new Float32Array(PN * 3), spd = new Float32Array(PN);
  for (let i = 0; i < PN; i++) { pos[i * 3] = (rnd() - 0.5) * half * 2.3; pos[i * 3 + 1] = rnd() * 30; pos[i * 3 + 2] = (rnd() - 0.5) * half * 2.3; spd[i] = 10 + rnd() * 40; }
  pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({ color: 0x64d8ff, size: 0.13, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const particles = new THREE.Points(pgeo, pmat); scene.add(particles);

  // ── cyan shockwave ──
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 96), new THREE.MeshBasicMaterial({ color: 0x2ec7ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 2; scene.add(ring);

  const onResize = () => { const s = size(); w = s.w; h = s.h; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); };
  window.addEventListener("resize", onResize);

  const start = performance.now();
  let raf = 0; let done = false;
  const finish = () => { if (done) return; done = true; onProgress?.(1); try { onDone(); } catch { /* noop */ } };
  if (reduced) { onProgress?.(1); const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  const frame = (now: number) => {
    const elapsed = now - start;
    const t = clamp01(elapsed / DURATION);
    const time = elapsed / 1000;
    onProgress?.(t);

    // camera: LINGER on a wide high establishing shot of the skyline (slow approach curve), then
    // descend toward the city near the end — never plunging through it into giant close slabs.
    const approach = Math.pow(clamp01(t), 1.9);   // stays wide early, accelerates in late
    camera.up.set(Math.sin(t * 1.2) * 0.1, 1, 0);  // subtle cinematic bank
    camera.position.set(Math.sin(t * 0.9) * 9 * (1 - approach * 0.4), 27 - approach * 15, 80 - approach * 66);
    camera.lookAt(0, 6 + approach * 3, 4 - approach * 30);

    // towers rise + pulse
    for (let k = 0; k < count; k++) {
      const d = info[k];
      const grow = clamp01((t - 0.04) * 1.8);
      const hgt = Math.max(0.4, d.base * grow * (1 + Math.sin(time * d.speed + d.phase) * 0.16));
      dummy.position.set(d.x, hgt / 2, d.z); dummy.scale.set(1, hgt, 1); dummy.updateMatrix();
      towers.setMatrixAt(k, dummy.matrix);
    }
    towers.instanceMatrix.needsUpdate = true;

    // particles stream toward camera
    const p = pgeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < PN; i++) { let z = p.getZ(i) + spd[i] * 0.016; if (z > 55) z -= half * 2.3 + 110; p.setZ(i, z); }
    p.needsUpdate = true;

    // fade-ins
    const fi = clamp01(t / 0.14);
    starMat.opacity = 0.85 * fi;
    (grid.material as THREE.Material).opacity = 0.42 * fi;
    mat.opacity = 0.97 * fi;
    pmat.opacity = Math.min(0.85, t * 1.6);

    // shockwave ~3.5s
    const sw = clamp01((t - 0.6) / 0.3);
    if (sw > 0) { const s = 1 + sw * 70; ring.scale.set(s, s, 1); (ring.material as THREE.MeshBasicMaterial).opacity = (1 - sw) * 0.7; }

    renderer.render(scene, camera);
    if (t >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    try {
      geo.dispose(); mat.dispose(); pgeo.dispose(); pmat.dispose(); starGeo.dispose(); starMat.dispose();
      (ring.geometry as THREE.BufferGeometry).dispose(); (ring.material as THREE.Material).dispose();
      (grid.material as THREE.Material).dispose(); (grid.geometry as THREE.BufferGeometry).dispose();
      renderer.dispose();
    } catch { /* noop */ }
  }
  return () => cleanup();
}
