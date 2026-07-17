import * as THREE from "three";

// APEX — "THE ASCENT" (~7s). A directed title sequence with a narrative: APEX means summit.
//   ACT I   — night. Four parallax mountain ridges made of glowing price-lines rise from the dark,
//             ticker-data streams flow through the sky, defocused bokeh dust drifts (depth of field).
//   ACT II  — an amber comet races along the hero ridge, igniting the crest behind it; candlestick
//             bars rise staggered from the ground to meet the ridge — the landscape becomes a chart.
//   ACT III — the ridge swells into a blazing SUMMIT under the wordmark; god-rays; exposure lifts;
//             the room crossfades over the settled hero frame. No cheap flash.
// Grade: vignette, 2.35:1 letterbox, film grain, slow push-in. Palette: deep blue→cyan with a single
// amber accent (complementary), atmospheric perspective on every layer.
// ZERO-LAG BY CONSTRUCTION: the whole film is ONE full-screen fragment shader (single draw call, no
// geometry, no textures, no post). An adaptive governor halves resolution once if the GPU is slow.
// HUD (ApexRoom) is updated imperatively via onProgress. Signature: startApexBoot(canvas, onDone, onProgress?) → stop().

const DURATION = 6000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const FRAG = `
precision highp float;
uniform float uT;     // 0..1 timeline
uniform float uSec;   // seconds
uniform vec2 uRes;

float h11(float n){ return fract(sin(n)*43758.5453123); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float vnoise(float x){ float i=floor(x), f=fract(x); float u=f*f*(3.0-2.0*f); return mix(h11(i), h11(i+1.0), u); }
float fbm(float x){ return 0.50*vnoise(x) + 0.27*vnoise(x*2.17+7.31) + 0.15*vnoise(x*4.31+3.17) + 0.08*vnoise(x*8.7+11.3); }

float ridge(float sx, float base, float amp, float fq, float sd, float drift){
  return base + amp*(fbm(sx*fq + sd + uSec*drift) - 0.45);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*uRes)/uRes.y;           // y in [-0.5, 0.5]

  // ---- direction: slow push-in + gentle drift (one confident move) ----
  float tt = uT;
  float zoom = 1.18 - 0.26*(tt*tt*(3.0-2.0*tt));
  float push = 1.35*tt;                          // parallax dolly
  uv *= zoom;

  float fadeIn  = smoothstep(0.00, 0.09, tt);
  float cometT  = smoothstep(0.05, 0.62, tt);    // comet crossing
  float alive   = smoothstep(0.04, 0.10, tt);
  float barsT   = tt;                            // bars rise inside act II (per-bar stagger below)
  float summit  = smoothstep(0.68, 0.94, tt);    // act III

  vec3 col = vec3(0.0);

  // ---- sky: ticker-data streams (LED boards in the fog) + gradient + chart gridlines ----
  col += vec3(0.02,0.05,0.10)*smoothstep(-0.5,0.5,uv.y+0.2);     // faint sky gradient
  {
    // faint horizontal price-gridlines — the world IS a chart
    for(int g=0; g<4; g++){
      float yg = -0.28 + 0.16*float(g);
      col += vec3(0.10,0.22,0.34)*exp(-abs(uv.y-yg)*320.0)*0.4*fadeIn;
    }
    // four rows of flowing data-dashes at different depths/speeds/directions
    for(int r=0;r<4;r++){
      float fr = float(r);
      float ry = 0.10 + 0.095*fr;
      float dir = mod(fr,2.0)<0.5 ? 1.0 : -1.0;
      float sp = dir * (0.05 + 0.045*fr);
      float sx = uv.x*(2.0+fr) + uSec*sp + fr*13.7;
      float cell = floor(sx*9.0);
      float on = step(0.35, h11(cell*3.3 + fr*7.7));
      float wlen = 0.30 + 0.18*h11(cell*5.1);
      float dash = on * smoothstep(wlen+0.1, wlen, abs(fract(sx*9.0)-0.5));
      float line = exp(-abs(uv.y-ry)*150.0);
      col += vec3(0.22,0.50,0.80)*dash*line*(0.30 - 0.055*fr)*fadeIn;
    }
  }

  // ---- bokeh dust: defocused foreground + fine background (depth of field feel) ----
  {
    vec2 g1 = uv*3.4 + vec2(uSec*0.010, uSec*0.006);
    vec2 c1 = floor(g1); vec2 f1 = fract(g1)-0.5;
    float j1 = h21(c1); vec2 o1 = vec2(h21(c1+1.3), h21(c1+4.7))-0.5;
    float b1 = exp(-dot(f1-o1*0.6,f1-o1*0.6)*26.0) * step(0.86, j1);
    col += vec3(0.10,0.22,0.36)*b1*0.55*fadeIn;                   // big soft foreground bokeh
    vec2 g2 = uv*14.0 + vec2(-uSec*0.004, 0.0);
    vec2 c2 = floor(g2); vec2 f2 = fract(g2)-0.5;
    float b2 = exp(-dot(f2,f2)*90.0) * step(0.93, h21(c2));
    col += vec3(0.35,0.55,0.75)*b2*0.35*fadeIn;                   // fine background dust
  }

  // ---- the four ridges (far → hero), each: crest glow + area fill, atmospheric perspective ----
  // layer 0 (farthest)
  {
    float sx = uv.x + push*0.25;
    float y = ridge(sx, 0.085, 0.11, 1.8, 5.0, 0.008);
    float d = uv.y - y;
    float crest = exp(-abs(d)*110.0);
    float fill = d<0.0 ? exp(d*9.0) : 0.0;
    col += vec3(0.05,0.13,0.28)*(crest*0.7 + fill*0.5)*fadeIn;
  }
  // layer 1
  {
    float sx = uv.x + push*0.45;
    float y = ridge(sx, -0.02, 0.14, 2.3, 21.0, 0.014);
    float d = uv.y - y;
    float crest = exp(-abs(d)*120.0);
    float fill = d<0.0 ? exp(d*8.0) : 0.0;
    col += vec3(0.06,0.22,0.42)*(crest*0.9 + fill*0.55)*fadeIn;
  }
  // layer 2 — with a dim mid-depth candle row (substance in the mid-ground)
  {
    float sx = uv.x + push*0.70;
    float y = ridge(sx, -0.13, 0.17, 2.9, 47.0, 0.022);
    float d = uv.y - y;
    float crest = exp(-abs(d)*130.0);
    float fill = d<0.0 ? exp(d*7.0) : 0.0;
    col += vec3(0.07,0.36,0.62)*(crest*1.1 + fill*0.6)*fadeIn;
    // mid-depth candles: half-size, dimmer, no stagger animation — depth texture
    float CW1 = 0.045;
    float bi = floor(sx/CW1);
    float c0 = (bi+0.5)*CW1;
    float tN = ridge(c0, -0.13, 0.17, 2.9, 47.0, 0.022);
    float tP = ridge(c0-CW1, -0.13, 0.17, 2.9, 47.0, 0.022);
    float bull = step(tP, tN);
    float bx = fract(sx/CW1);
    float xm = smoothstep(0.14,0.30,bx)*smoothstep(0.86,0.70,bx);
    float body = step(-0.52, uv.y)*step(uv.y, tN-0.004)*xm;
    vec3 bCol = mix(vec3(0.55,0.18,0.26), vec3(0.10,0.45,0.30), bull);
    col += bCol*body*0.10*fadeIn;
    col += bCol*exp(-abs(uv.y-tN)*180.0)*xm*0.35*fadeIn;
  }
  // ---- hero layer 3: the chart-ridge with comet, candles and the final SUMMIT ----
  {
    float pf = 1.0;
    float sx = uv.x + push*pf;
    // comet position in scene space; it parks where the summit will rise
    float scx = mix(-1.35, 0.55, cometT);
    float peakBump = summit * exp(-pow((sx - 0.55)*2.6, 2.0)) * 0.42;
    float yBase = ridge(sx, -0.235, 0.20, 3.6, 83.0, 0.03);
    float y = yBase + peakBump;

    float d = uv.y - y;
    // crest lights up progressively BEHIND the comet, fully lit by act III
    float lit = max(smoothstep(scx+0.03, scx-0.10, sx)*alive, summit);
    float crest = exp(-abs(d)*150.0);
    float fill = d<0.0 ? exp(d*6.0) : 0.0;
    vec3 heroCol = mix(vec3(0.10,0.45,0.75), vec3(0.30,0.85,1.05), lit);
    col += heroCol*(crest*(0.5+1.3*lit) + fill*(0.5+0.35*lit))*fadeIn;

    // candlestick bars rising from the ground to the ridge (staggered, green/red by slope)
    float CW2 = 0.062;
    float bi = floor(sx/CW2);
    float cx0 = (bi+0.5)*CW2;
    float topNow  = ridge(cx0, -0.235, 0.20, 3.6, 83.0, 0.03) + summit*exp(-pow((cx0-0.55)*2.6,2.0))*0.42;
    float topPrev = ridge(cx0-CW2, -0.235, 0.20, 3.6, 83.0, 0.03) + summit*exp(-pow((cx0-CW2-0.55)*2.6,2.0))*0.42;
    float bull = step(topPrev, topNow);
    float st = h11(bi*7.7);
    float rise = smoothstep(0.26+0.34*st, 0.44+0.34*st, barsT);
    float yTop = mix(-0.52, topNow-0.006, rise);
    float bx = fract(sx/CW2);
    float xm = smoothstep(0.10,0.24,bx)*smoothstep(0.90,0.76,bx);
    float body = step(-0.52, uv.y)*step(uv.y, yTop)*xm;
    vec3 bCol = mix(vec3(0.85,0.25,0.35), vec3(0.12,0.75,0.45), bull);
    col += bCol*body*0.20*fadeIn;                                    // glass body
    col += bCol*exp(-abs(uv.y-yTop)*160.0)*xm*rise*1.1*fadeIn;       // glowing close-cap
    // wick: thin brighter core in the middle of the bar above the body
    float wick = exp(-pow((bx-0.5)*26.0,2.0)) * step(yTop, uv.y) * step(uv.y, yTop+0.035*rise);
    col += bCol*wick*0.5*fadeIn;

    // the amber comet — rides the crest, becomes the summit star
    float cuvx = scx - push*pf;                    // back to view space
    float cy = ridge(scx, -0.235, 0.20, 3.6, 83.0, 0.03) + summit*exp(-pow((scx-0.55)*2.6,2.0))*0.42;
    vec2 cp = vec2(cuvx, cy);
    float cd = length((uv-cp)*vec2(1.0,1.25));
    float head = exp(-cd*40.0)*1.5 + exp(-cd*14.0)*0.22;         // small sharp head, no orb
    col += vec3(1.0,0.72,0.38)*head*alive*(1.0-summit*0.6);
    // trail hugging the crest behind the head
    float behind = smoothstep(cuvx+0.02, cuvx-0.30, uv.x);
    col += vec3(1.0,0.62,0.30)*exp(-abs(d)*170.0)*behind*alive*(1.0-summit)*0.8;

    // summit: a crisp cool star + a thin light pillar rising from the peak — no sun, no rays
    vec2 pk = vec2(0.55 - push*pf, cy);
    vec2 pv = uv - pk;
    float pr = length(pv);
    col += vec3(0.85,0.95,1.05)*exp(-pr*46.0)*1.6*summit;                                  // pin-sharp star
    float pillar = exp(-abs(pv.x)*130.0)*step(0.0,pv.y)*exp(-pv.y*4.0);
    col += vec3(0.55,0.85,1.05)*pillar*0.55*summit;                                        // beacon up
    col += vec3(0.30,0.70,1.00)*exp(-abs(d)*200.0)*smoothstep(0.35,0.0,abs(sx-0.55))*summit*0.9; // white-hot crest near peak
  }

  // ---- act III exposure lift (earned light, not a flash) ----
  col *= 1.0 + 0.22*summit;

  // ---- film grade: vignette, 2.35:1 letterbox, grain, fade ----
  vec2 q = frag/uRes;
  col *= smoothstep(1.08, 0.34, length((q-0.5)*vec2(1.85,1.2)));
  col *= smoothstep(0.072, 0.084, q.y)*smoothstep(0.928, 0.916, q.y);
  float grain = h21(frag + fract(uSec)*373.0);
  col += (grain-0.5)*0.028;
  col *= fadeIn;

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
  const camera = new THREE.PerspectiveCamera();  // unused by the shader; required by render()
  const uniforms = { uT: { value: 0 }, uSec: { value: 0 }, uRes: { value: new THREE.Vector2(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()) } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: `void main(){ gl_Position = vec4(position, 1.0); }`, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);

  const syncRes = () => uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  const onResize = () => { const s = size(); w = s.w; h = s.h; renderer.setSize(w, h, false); syncRes(); };
  window.addEventListener("resize", onResize);

  let raf = 0, done = false;
  const finish = () => { if (done) return; done = true; onProgress?.(1); try { onDone(); } catch { /* noop */ } };
  if (reduced) { onProgress?.(1); const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  // Warm-up: render frame 0 first (forces shader compile), THEN start the clock — so a compile hitch
  // can never eat the film's timeline (first-load GPUs, headless renderers).
  let startT = -1;
  let frames = 0, accum = 0, lastNow = 0, degraded = false;

  const frame = (now: number) => {
    if (startT < 0) {
      uniforms.uT.value = 0; uniforms.uSec.value = 0;
      renderer.render(scene, camera);
      startT = performance.now(); lastNow = startT;
      raf = requestAnimationFrame(frame);
      return;
    }
    const t = clamp01((now - startT) / DURATION);
    onProgress?.(t);
    const dt = now - lastNow; lastNow = now;
    if (!degraded && frames < 40) { accum += dt; frames++; if (frames === 40 && accum / frames > 24) { degraded = true; renderer.setPixelRatio(0.85); renderer.setSize(w, h, false); syncRes(); } }

    uniforms.uT.value = t;
    uniforms.uSec.value = (now - startT) / 1000;
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
