import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Cortex, STATES, type CortexState } from "./Cortex";

// Batch 1 (plan v2 §3): the centrepiece ALONE on a black phone screen, with a live frame-time
// read and the knobs needed to run the fallback ladder (30k+bloom → 15k+bloom → 15k no bloom).
// Tap the screen to cycle idle → thinking → speaking → globe. Nothing else is on this page.

function Meter({ onSample }: { onSample: (fps: number, ms: number) => void }) {
  const acc = useRef({ t: 0, n: 0, worst: 0 });
  useFrame((_, dt) => {
    const a = acc.current; a.t += dt; a.n++; a.worst = Math.max(a.worst, dt);
    if (a.t >= 1) { onSample(a.n / a.t, (a.worst * 1000)); a.t = 0; a.n = 0; a.worst = 0; }
  });
  return null;
}

// While "speaking", a fake voice envelope drives the waveform ring until batch 5 wires real audio.
function useFakeAudio(on: boolean) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) { setV(0); return; }
    let raf = 0; const t0 = performance.now();
    const tick = () => { const t = (performance.now() - t0) / 1000; setV(0.35 + 0.65 * Math.abs(Math.sin(t * 2.1) * Math.sin(t * 5.3))); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return v;
}

export function Batch1() {
  const [state, setState] = useState<CortexState>("idle");
  const q = new URLSearchParams(location.search);
  const [count, setCount] = useState(Number(q.get("n")) || 30000);
  const [bloom, setBloom] = useState(q.get("bloom") !== "0");
  const [fps, setFps] = useState(0);
  const [worst, setWorst] = useState(0);
  const [geo, setGeo] = useState<any>(null);
  const [geoErr, setGeoErr] = useState("");
  const audio = useFakeAudio(state === "speaking");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  useEffect(() => {
    fetch("/globe-room/countries.geojson").then((r) => { if (!r.ok) throw new Error(`countries.geojson ${r.status}`); return r.json(); }).then(setGeo).catch((e) => setGeoErr(String(e.message || e)));
  }, []);

  const next = () => setState(STATES[(STATES.indexOf(state) + 1) % STATES.length]);

  return (
    <div className="b1" onClick={next} style={{ background: "#000" }}>
      <div className="b1-vignette" />
      <Canvas
        className="b1-canvas"
        camera={{ fov: 40, position: [0, 0, 8.6], near: 0.1, far: 50 }}
        gl={{ alpha: true, antialias: false, powerPreference: "high-performance", stencil: false }}
        dpr={dpr}
        style={{ position: "absolute", inset: 0 }}
      >
        <Suspense fallback={null}>
          <Cortex count={count} state={state} audio={audio} geo={geo} />
        </Suspense>
        <Meter onSample={(f, w) => { setFps(f); setWorst(w); }} />
        {bloom ? (
          <EffectComposer multisampling={0} resolutionScale={0.5}>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.42} luminanceSmoothing={0.3} radius={0.45} />
          </EffectComposer>
        ) : null}
      </Canvas>

      <div className="b1-hud" onClick={(e) => e.stopPropagation()}>
        <div className="b1-row mono">
          <span className={fps >= 55 ? "ok" : fps >= 40 ? "warn" : "bad"}>{fps ? fps.toFixed(0) : "–"} fps</span>
          <span>worst {worst ? worst.toFixed(1) : "–"} ms</span>
          <span>{(count / 1000).toFixed(0)}k · dpr {dpr.toFixed(1)} · bloom {bloom ? "on" : "off"}</span>
        </div>
        <div className="b1-row">
          {STATES.map((s) => <button key={s} type="button" className={s === state ? "on" : ""} onClick={() => setState(s)}>{s}</button>)}
        </div>
        <div className="b1-row">
          <button type="button" className={count === 30000 ? "on" : ""} onClick={() => setCount(30000)}>30k</button>
          <button type="button" className={count === 15000 ? "on" : ""} onClick={() => setCount(15000)}>15k</button>
          <button type="button" className={bloom ? "on" : ""} onClick={() => setBloom((b) => !b)}>bloom</button>
          <span className="b1-note">{geoErr ? `globe form: ${geoErr}` : geo ? "globe form: outlines loaded" : "globe form: loading outlines…"}</span>
        </div>
      </div>
    </div>
  );
}
