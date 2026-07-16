import * as THREE from "three";

// APEX — 3D cinematic loading screen (~5s). A camera fly-through of a neon "data city":
// a grid of candlestick towers (green/red) rising from a reflective floor, data-stream particles
// rushing the lens, a cyan shockwave near the end, then the APEX wordmark resolves. WebGL/Three.js.
// Signature preserved: startApexBoot(canvas, onDone) → stop(). onDone fires once at 100%.

const DURATION = 5000; // ms
const GRID = 13;        // towers per side
const SPACING = 3.2;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function startApexBoot(canvas: HTMLCanvasElement, onDone: () => void): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch { // WebGL unavailable → resolve immediately so the room never sticks
    const t = setTimeout(onDone, 200); return () => clearTimeout(t);
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x01060c, 1);

  const size = () => ({ w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight });
  let { w, h } = size();
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02070f, 0.018);
  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 400);

  // ── neon floor grid ──
  const grid = new THREE.GridHelper(GRID * SPACING * 1.6, 46, 0x1f7fb0, 0x0e3a52);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = -0.02;
  scene.add(grid);
  // faint reflection grid below
  const grid2 = grid.clone(); grid2.position.y = -6; (grid2.material as THREE.Material).opacity = 0.12; scene.add(grid2);

  // ── candlestick towers (instanced) ──
  const geo = new THREE.BoxGeometry(0.9, 1, 0.9);
  // InstancedMesh applies per-instance colour via setColorAt/instanceColor automatically — do NOT
  // set vertexColors (that expects a geometry colour attribute and renders the towers black).
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, fog: true });
  const count = GRID * GRID;
  const towers = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const cGreen = new THREE.Color(0x1fe38a), cRed = new THREE.Color(0xff5364), cCyan = new THREE.Color(0x2ec7ff);
  type TowerInfo = { x: number; z: number; base: number; phase: number; speed: number; up: boolean };
  const info: TowerInfo[] = [];
  let seed = 20240716;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const half = ((GRID - 1) * SPACING) / 2;
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const idx = i * GRID + j;
    const x = i * SPACING - half, z = j * SPACING - half;
    const up = rnd() > 0.46;
    info.push({ x, z, base: 2 + rnd() * 12, phase: rnd() * Math.PI * 2, speed: 1.5 + rnd() * 3, up });
    towers.setColorAt(idx, (up ? cGreen : cRed).clone().lerp(cCyan, rnd() * 0.25));
  }
  scene.add(towers);

  // ── data-stream particles rushing the lens ──
  const PN = 1400;
  const pgeo = new THREE.BufferGeometry();
  const pos = new Float32Array(PN * 3);
  const spd = new Float32Array(PN);
  for (let i = 0; i < PN; i++) {
    pos[i * 3] = (rnd() - 0.5) * half * 2.4;
    pos[i * 3 + 1] = rnd() * 26;
    pos[i * 3 + 2] = (rnd() - 0.5) * half * 2.4;
    spd[i] = 8 + rnd() * 34;
  }
  pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({ color: 0x6fd4ff, size: 0.14, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const particles = new THREE.Points(pgeo, pmat);
  scene.add(particles);

  // ── cyan shockwave ring ──
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 96), new THREE.MeshBasicMaterial({ color: 0x2ec7ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 3; scene.add(ring);

  // ── APEX wordmark (canvas texture → plane, resolves at the end) ──
  const tc = document.createElement("canvas"); tc.width = 1024; tc.height = 512;
  const tctx = tc.getContext("2d")!;
  tctx.clearRect(0, 0, 1024, 512);
  tctx.textAlign = "center"; tctx.textBaseline = "middle";
  tctx.fillStyle = "#eaf6ff"; tctx.font = "800 190px Inter, system-ui, sans-serif";
  tctx.shadowColor = "#2ec7ff"; tctx.shadowBlur = 60;
  tctx.fillText("APEX", 512, 232);
  tctx.shadowBlur = 0; tctx.fillStyle = "rgba(120,180,215,.85)";
  tctx.font = "600 40px Inter, system-ui, sans-serif";
  try { (tctx as unknown as { letterSpacing: string }).letterSpacing = "14px"; } catch { /* not supported */ }
  tctx.fillText("INTELLIGENT TRADING TERMINAL", 512, 360);
  const tex = new THREE.CanvasTexture(tc); tex.anisotropy = 4;
  const title = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
  title.renderOrder = 10; scene.add(title);

  // full-frame cyan flash intensity at the peak
  let flash = 0;

  const onResize = () => { const s = size(); w = s.w; h = s.h; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); };
  window.addEventListener("resize", onResize);

  const start = performance.now();
  let raf = 0; let done = false;
  const finish = () => { if (done) return; done = true; try { onDone(); } catch { /* noop */ } };
  if (reduced) { const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  const tmpColor = new THREE.Color();

  const frame = (now: number) => {
    const elapsed = now - start;
    const t = clamp01(elapsed / DURATION);
    const time = elapsed / 1000;

    // camera: establishing high-wide shot of the glowing skyline, then descend + fly through the avenue
    const fly = easeInOut(clamp01(t / 0.96));
    const sway = Math.sin(t * 1.7) * 12 * (1 - fly * 0.7);
    camera.position.set(sway, 30 - fly * 24, 62 - fly * 86);
    camera.lookAt(sway * 0.3, 9 - fly * 2, -6 - fly * 8);

    // towers rise + pulse
    for (let k = 0; k < count; k++) {
      const d = info[k];
      const grow = clamp01((t - 0.05) * 1.7);
      const pulse = 1 + Math.sin(time * d.speed + d.phase) * 0.18;
      const hgt = Math.max(0.4, d.base * grow * pulse);
      dummy.position.set(d.x, hgt / 2, d.z);
      dummy.scale.set(1, hgt, 1);
      dummy.updateMatrix();
      towers.setMatrixAt(k, dummy.matrix);
    }
    towers.instanceMatrix.needsUpdate = true;

    // particles stream toward the camera
    const p = pgeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < PN; i++) {
      let z = p.getZ(i) + spd[i] * 0.016;
      if (z > 50) z -= half * 2.4 + 100;
      p.setZ(i, z);
    }
    p.needsUpdate = true;
    pmat.opacity = Math.min(0.8, t * 1.6);

    // shockwave near 3.6s
    const sw = clamp01((t - 0.62) / 0.28);
    if (sw > 0) { const s = 1 + sw * 60; ring.scale.set(s, s, 1); (ring.material as THREE.MeshBasicMaterial).opacity = (1 - sw) * 0.8; }

    // brief cyan flash at the peak, then decay
    if (t > 0.72 && t < 0.82) flash = Math.min(1, flash + 0.12);
    flash *= 0.9;
    tmpColor.setRGB(0.02 + flash * 0.15, 0.05 + flash * 0.45, 0.09 + flash * 0.7);
    renderer.setClearColor(tmpColor, 1);

    // wordmark resolves + gentle push-in over the last ~1.4s
    const tw = clamp01((t - 0.72) / 0.24);
    title.position.set(0, 12, 6);
    title.lookAt(camera.position);
    (title.material as THREE.MeshBasicMaterial).opacity = tw;
    const ts = 0.78 + tw * 0.22;
    title.scale.set(ts, ts, ts);

    // opening fade-in from black
    const fadeIn = clamp01(t / 0.12);
    (grid.material as THREE.Material).opacity = 0.5 * fadeIn;
    mat.opacity = 0.92 * fadeIn;

    renderer.render(scene, camera);

    if (t >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    try {
      geo.dispose(); mat.dispose(); pgeo.dispose(); pmat.dispose(); tex.dispose();
      (ring.geometry as THREE.BufferGeometry).dispose(); (ring.material as THREE.Material).dispose();
      (title.geometry as THREE.BufferGeometry).dispose(); (title.material as THREE.Material).dispose();
      (grid.material as THREE.Material).dispose(); (grid.geometry as THREE.BufferGeometry).dispose();
      renderer.dispose();
    } catch { /* noop */ }
  }

  return () => cleanup();
}
