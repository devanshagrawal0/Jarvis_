import * as THREE from "three";

// APEX — "The Singularity" cinematic loading screen (~6.8s). A black void with drifting star dust
// and a distant pulsing iris ring (the Oracle's eye); the camera accelerates INTO it and it blows
// past into a hyperspace DATA TUNNEL — a rolling vortex of cyan/violet light streaks with rare
// green/red price-tick comets rushing the lens — building speed, ending in a white-cyan flash that
// hands off to the room. Vignette + 2.35:1 letterbox + film grain graded in-shader.
//
// ZERO-LAG BY CONSTRUCTION: the entire film is ONE full-screen fragment shader — a single draw call,
// no geometry, no textures, no post passes, no per-frame JS work beyond three uniform writes. This is
// demoscene-style rendering; it holds 60fps on integrated GPUs. An adaptive governor still measures
// the first frames and halves resolution once if the GPU is genuinely slow.
//
// HUD (ApexRoom) is updated imperatively via onProgress — no React re-renders.
// Signature preserved: startApexBoot(canvas, onDone, onProgress?) → stop().

const DURATION = 6800;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const FRAG = `
precision highp float;
uniform float uT;     // 0..1 timeline
uniform float uSec;   // seconds elapsed
uniform vec2 uRes;

float h1(float n){ return fract(sin(n)*43758.5453123); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

vec3 palette(float x){
  vec3 blue   = vec3(0.10,0.35,0.90);
  vec3 cyan   = vec3(0.18,0.78,1.00);
  vec3 violet = vec3(0.48,0.30,1.00);
  return x < 0.5 ? mix(blue, cyan, x*2.0) : mix(cyan, violet, (x-0.5)*2.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*uRes)/uRes.y;

  // ---- timeline beats ----
  float appear   = smoothstep(0.00, 0.10, uT);   // fade from black
  float approach = smoothstep(0.06, 0.30, uT);   // the eye approaches
  float tunnelIn = smoothstep(0.24, 0.40, uT);   // ...and blows past into the tunnel
  float speed    = 0.25 + 4.0*smoothstep(0.28, 0.78, uT) + 7.0*smoothstep(0.82, 0.98, uT);
  float flash    = smoothstep(0.94, 1.00, uT);   // singularity

  // ---- camera: slow roll + micro shake that grows with speed ----
  float roll = 0.9*uT*uT + 0.015*sin(uSec*2.2);
  float cr = cos(roll), sr = sin(roll);
  uv = mat2(cr,-sr,sr,cr)*uv;
  uv += tunnelIn*0.006*vec2(sin(uSec*15.0), cos(uSec*19.0));

  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x);

  vec3 col = vec3(0.0);

  // ---- act I: star dust drifting in the void ----
  {
    vec2 sp = uv*14.0 + vec2(0.0, uSec*0.05);
    vec2 cell = floor(sp);
    float s = h2(cell);
    float tw = 0.6 + 0.4*sin(uSec*(1.0+2.0*h2(cell+3.3)) + s*20.0);
    float star = step(0.994, s) * (0.4+0.6*h2(cell+7.7)) * tw;
    col += vec3(0.55,0.70,0.85)*star*appear*(1.0-tunnelIn);
  }

  // ---- act I: the Oracle's iris — a distant ring that approaches and swallows the camera ----
  {
    float R0 = mix(0.10, 2.60, approach*approach);
    float ring = exp(-pow(abs(r-R0)*26.0, 1.4));
    float pulse = 0.75 + 0.25*sin(uSec*3.0);
    col += palette(0.55)*ring*pulse*appear*1.6*(1.0-flash);
    col += palette(0.40)*exp(-r*7.0)*0.25*approach*(1.0-tunnelIn);   // faint pupil halo
  }

  // ---- act II: the data tunnel ----
  {
    float z = 0.22/r;                       // tunnel depth from radius
    float zz = z + uSec*speed;              // rushing forward

    float swirl = 0.55*sin(z*0.35 + uT*3.0)*tunnelIn;
    float ang = a + swirl;

    float SEC = 42.0;
    float sector = floor((ang/6.2831853 + 0.5)*SEC);
    float sh = h1(sector*13.7);

    // dashes streaming toward the lens — the market's data stream
    float stripe = fract(zz*(0.35+0.30*sh) + sh*9.0);
    float dash = smoothstep(0.00,0.05,stripe)*smoothstep(0.30,0.10,stripe);
    // occasional bright comets
    float comet = step(0.965, h1(sector*3.1 + floor(zz*0.35 + sh*9.0)*1.7));

    float body = exp(-1.6*r)*(1.0-exp(-9.0*r));       // hide the far void + soften the rim
    float wall = dash*(0.5+0.9*comet);

    float hueSel = h1(sector*29.3);
    vec3 wcol = palette(hueSel);
    if(hueSel > 0.92)      wcol = vec3(0.22,1.00,0.55);  // green tick
    else if(hueSel < 0.06) wcol = vec3(1.00,0.30,0.42);  // red tick

    float fog = exp(-2.4*r);                           // the black hole ahead stays mysterious
    vec3 tcol = wcol*wall*body*(1.0-fog*0.85);
    tcol += palette(0.5)*exp(-r*5.5)*0.045*speed;      // core glow builds with velocity

    col = mix(col, col + tcol*2.1, tunnelIn);
  }

  // ---- act III: the singularity flash ----
  col += vec3(0.75,0.92,1.0)*flash*flash*1.6;

  // ---- film grade: vignette, 2.35:1 letterbox, grain, fade ----
  vec2 q = frag/uRes;
  col *= smoothstep(1.05, 0.35, length((q-0.5)*vec2(1.9,1.15)));
  col *= smoothstep(0.070, 0.082, q.y)*smoothstep(0.930, 0.918, q.y);
  float grain = h2(frag + fract(uSec)*371.0);
  col += (grain-0.5)*0.03;
  col *= appear;

  gl_FragColor = vec4(col, 1.0);
}`;

export function startApexBoot(canvas: HTMLCanvasElement, onDone: () => void, onProgress?: (t: number) => void): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" }); }
  catch { const t = setTimeout(() => { onProgress?.(1); onDone(); }, 200); return () => clearTimeout(t); }
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));

  const size = () => ({ w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight });
  let { w, h } = size(); renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();           // unused by the shader; required by render()
  const uniforms = { uT: { value: 0 }, uSec: { value: 0 }, uRes: { value: new THREE.Vector2(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()) } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: `void main(){ gl_Position = vec4(position, 1.0); }`, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);

  const syncRes = () => uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  const onResize = () => { const s = size(); w = s.w; h = s.h; renderer.setSize(w, h, false); syncRes(); };
  window.addEventListener("resize", onResize);

  const start = performance.now(); let raf = 0, done = false;
  const finish = () => { if (done) return; done = true; onProgress?.(1); try { onDone(); } catch { /* noop */ } };
  if (reduced) { onProgress?.(1); const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  // adaptive governor: if the first ~40 frames average slow, halve resolution once — belt & braces.
  let frames = 0, accum = 0, lastNow = start, degraded = false;

  const frame = (now: number) => {
    const t = clamp01((now - start) / DURATION);
    onProgress?.(t);
    const dt = now - lastNow; lastNow = now;
    if (!degraded && frames < 40) { accum += dt; frames++; if (frames === 40 && accum / frames > 24) { degraded = true; renderer.setPixelRatio(0.85); renderer.setSize(w, h, false); syncRes(); } }

    uniforms.uT.value = t;
    uniforms.uSec.value = (now - start) / 1000;
    renderer.render(scene, camera);

    if (t >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function cleanup() {
    cancelAnimationFrame(raf); window.removeEventListener("resize", onResize);
    try { quad.geometry.dispose(); mat.dispose(); renderer.dispose(); } catch { /* noop */ }
  }
  return () => cleanup();
}
