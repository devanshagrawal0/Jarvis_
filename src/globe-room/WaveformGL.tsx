import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";

/**
 * WebGL waveform strip with REAL bloom: HDR additive dot-columns whose hot
 * cores flood light like the reference. Data source: a live WebAudio
 * AnalyserNode when provided (mic / TTS), procedural idle motion otherwise.
 */

export type WaveformGLProps = {
  active: boolean;
  /** returns a live AnalyserNode or null (idle animation) */
  getAnalyser?: () => AnalyserNode | null;
};

const COLS = 260;
const MAX_DOTS = 12000;

export function WaveformGL({ active, getAnalyser }: WaveformGLProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const analyserRef = useRef<(() => AnalyserNode | null) | undefined>(getAnalyser);
  analyserRef.current = getAnalyser;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    // uv-space camera: x 0..1, y 0..1
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

    const positions = new Float32Array(MAX_DOTS * 3);
    const colors = new Float32Array(MAX_DOTS * 3);
    const sizes = new Float32Array(MAX_DOTS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));

    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          if (dot(d, d) > 0.25) discard;
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);

    // very restrained bloom: only the brightest peak tips get a faint halo —
    // the wave itself stays crisp thin lines
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({
          intensity: 0.35,
          luminanceThreshold: 0.85,
          luminanceSmoothing: 0.1,
          mipmapBlur: true
        })
      )
    );

    // smoothed band amplitudes
    const amps = new Float32Array(COLS);
    const freq = new Uint8Array(1024);
    let t = 0;
    let raf = 0;

    const bump = (x: number, center: number, width: number) =>
      Math.exp(-((x - center) ** 2) / (2 * width * width));

    const idleAmp = (u: number) => {
      // wave envelopes across the full strip; per-column spikiness so
      // adjacent thin lines differ like a real audio waveform
      const env =
        bump(u, 0.14 + 0.03 * Math.sin(t * 0.8 + 1), 0.04) * 0.65 +
        bump(u, 0.30 + 0.04 * Math.sin(t * 0.7), 0.05) * 0.95 +
        bump(u, 0.48 + 0.03 * Math.sin(t * 0.9 + 2), 0.055) * 1.0 +
        bump(u, 0.66 + 0.04 * Math.sin(t * 1.1 + 1), 0.045) * 0.85 +
        bump(u, 0.85 + 0.03 * Math.sin(t * 0.8 + 4), 0.04) * 0.7;
      const spike =
        0.35 +
        0.65 * Math.abs(Math.sin(u * 231 + t * 4.2)) * Math.abs(Math.sin(u * 87 - t * 2.2));
      // low chatter everywhere so the whole width stays alive
      const chatter =
        0.06 + 0.07 * Math.max(0, Math.sin(u * 217 + t * 1.7) * Math.sin(u * 53 - t * 1.1));
      return Math.min(1, env * spike + chatter);
    };

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dp = Math.min(devicePixelRatio, 2);
      if (canvas.width !== w * dp || canvas.height !== h * dp) {
        renderer.setSize(w, h, false);
        renderer.setPixelRatio(dp);
        composer.setSize(w, h);
      }

      t += activeRef.current ? 0.05 : 0.03;
      const analyser = activeRef.current ? analyserRef.current?.() ?? null : null;
      if (analyser) {
        analyser.getByteFrequencyData(freq);
        const bins = Math.min(analyser.frequencyBinCount, 360);
        for (let i = 0; i < COLS; i += 1) {
          // log-ish mapping over usable voice bins, mirrored around center
          const c = Math.abs(i / COLS - 0.5) * 2;
          const bin = Math.floor(2 + (c ** 1.4) * (bins - 4));
          const target = (freq[bin] / 255) ** 1.3 * 1.15;
          amps[i] += (target - amps[i]) * (target > amps[i] ? 0.5 : 0.12);
        }
      } else {
        for (let i = 0; i < COLS; i += 1) {
          const target = idleAmp(i / COLS) * (activeRef.current ? 1.35 : 1.0);
          amps[i] += (target - amps[i]) * 0.25;
        }
      }

      // rebuild dot buffers — each column is one THIN vertical line of small
      // dots (reads as a crisp line), mirrored around the baseline. No glow
      // blobs, no fat cores.
      const dotStepPx = 3.2;
      const stepUv = dotStepPx / h;
      let n = 0;
      for (let i = 0; i < COLS && n < MAX_DOTS - 40; i += 1) {
        const x = (i + 0.5) / COLS;
        const amp = amps[i];
        const half = amp * 0.46;

        // baseline dot (dim teal)
        positions[n * 3] = x; positions[n * 3 + 1] = 0.52; positions[n * 3 + 2] = 0;
        colors[n * 3] = 0.05; colors[n * 3 + 1] = 0.16; colors[n * 3 + 2] = 0.16;
        sizes[n] = 1.3 * dp;
        n += 1;

        if (half < stepUv) continue;
        const peak = amp > 0.55;
        const r = 0.12 + amp * 0.3;
        const g = 0.3 + amp * 0.55;
        const b = 0.6 + amp * 0.55;
        for (let y = stepUv; y <= half && n < MAX_DOTS - 2; y += stepUv) {
          const fade = 1 - (y / half) * 0.45;
          for (const s of [1, -1]) {
            positions[n * 3] = x;
            positions[n * 3 + 1] = 0.52 + y * s;
            positions[n * 3 + 2] = 0;
            colors[n * 3] = r * fade;
            colors[n * 3 + 1] = g * fade;
            colors[n * 3 + 2] = b * fade;
            sizes[n] = 1.5 * dp;
            n += 1;
          }
        }
        // slightly brighter tip on tall lines (catches the faint bloom)
        if (peak && n < MAX_DOTS - 2) {
          for (const s of [1, -1]) {
            positions[n * 3] = x;
            positions[n * 3 + 1] = 0.52 + half * s;
            positions[n * 3 + 2] = 0;
            colors[n * 3] = 0.55; colors[n * 3 + 1] = 0.85; colors[n * 3 + 2] = 1.05;
            sizes[n] = 1.6 * dp;
            n += 1;
          }
        }
      }
      geometry.setDrawRange(0, n);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;

      composer.render();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      composer.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="jcb-wave" />;
}
