/* THE FORGE — THE ORACLE.
   A holographic 3D projection of how a strategy plays out over time. The equity
   curve becomes a glowing ribbon flying forward through time; the Monte-Carlo
   spread becomes a translucent probability cone with a bright median spine.
   Orbit to inspect; Jarvis narrates the odds. Lazy-mounted (only when opened),
   so the r3f/three cost is never paid at idle. */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls, Grid, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { BacktestResult, MonteCarlo } from "./forge-engine";

const SPAN = 20;      // world length along the time axis
const HEIGHT = 7;     // vertical scale
const ICE = "#dce6f0", SPINE = "#eaf6ff", POS = "#4dffb0", NEG = "#ff7285";

/* Normalize an equity curve to [0..1] then to world Y. */
function toPoints(eq: { equity: number }[], scale = 1): [number, number, number][] {
  if (eq.length < 2) return [[-SPAN / 2, 0, 0], [SPAN / 2, 0, 0]];
  const vals = eq.map((e) => e.equity);
  const lo = Math.min(...vals), hi = Math.max(...vals), rg = hi - lo || 1;
  const N = eq.length;
  return eq.map((e, i) => {
    const x = (i / (N - 1)) * SPAN - SPAN / 2;
    const y = (((e.equity - lo) / rg) - 0.5) * HEIGHT * scale;
    return [x, y, 0];
  });
}

function EquityRibbon({ result }: { result: BacktestResult }) {
  const pts = useMemo(() => toPoints(result.equity), [result]);
  const up = result.metrics.totalReturnPct >= 0;
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => { if (ref.current) ref.current.position.z = Math.sin(state.clock.elapsedTime * 0.4) * 0.15; });
  return (
    <group ref={ref}>
      <Line points={pts} color={up ? POS : NEG} lineWidth={3} />
      {/* soft under-glow copy */}
      <Line points={pts.map(([x, y, z]) => [x, y, z - 0.02] as [number, number, number])} color={up ? POS : NEG} lineWidth={8} transparent opacity={0.12} />
    </group>
  );
}

/* Probability cone: interpolate the spine outward to p5 / p95 finals. */
function ProbabilityCone({ result, mc }: { result: BacktestResult; mc: MonteCarlo }) {
  const { upper, lower, spine } = useMemo(() => {
    const base = toPoints(result.equity);
    const N = base.length;
    const p5 = mc.retP5 / 100, p95 = mc.retP95 / 100, p50 = mc.retP50 / 100;
    const fan = (mult: number) => base.map(([x, y, z], i) => {
      const f = i / (N - 1);
      return [x, y + mult * HEIGHT * 0.5 * f, z] as [number, number, number];
    });
    return { upper: fan(p95 - p50 + 0.15), lower: fan(p5 - p50 - 0.15), spine: fan(0) };
  }, [result, mc]);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts: number[] = [];
    for (let i = 0; i < upper.length - 1; i++) {
      const a = upper[i], b = lower[i], c = upper[i + 1], d = lower[i + 1];
      verts.push(...a, ...b, ...c, ...c, ...b, ...d);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, [upper, lower]);

  return (
    <group>
      <mesh geometry={geom}><meshBasicMaterial color={ICE} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <Line points={upper} color={ICE} lineWidth={1} transparent opacity={0.5} dashed dashSize={0.3} gapSize={0.2} />
      <Line points={lower} color={ICE} lineWidth={1} transparent opacity={0.5} dashed dashSize={0.3} gapSize={0.2} />
      <Line points={spine} color={SPINE} lineWidth={2} />
    </group>
  );
}

function Scene({ result, mc }: { result: BacktestResult; mc: MonteCarlo | null }) {
  return (
    <>
      <color attach="background" args={["#06070b"]} />
      <fog attach="fog" args={["#06070b", 18, 42]} />
      <ambientLight intensity={0.5} />
      <Grid args={[SPAN * 1.4, SPAN * 1.4]} position={[0, -HEIGHT / 2 - 1, 0]} cellColor="#1c2530" sectionColor="#2b3a49" fadeDistance={40} infiniteGrid cellSize={1} sectionSize={5} />
      {mc && <ProbabilityCone result={result} mc={mc} />}
      <EquityRibbon result={result} />
      <Html position={[-SPAN / 2, HEIGHT / 2 + 1.4, 0]} transform={false} className="oracle-tag">START · $100</Html>
      <Html position={[SPAN / 2, HEIGHT / 2 + 1.4, 0]} transform={false} className="oracle-tag">NOW</Html>
      <OrbitControls enablePan={false} minDistance={10} maxDistance={34} autoRotate autoRotateSpeed={0.5} maxPolarAngle={Math.PI * 0.62} />
      <EffectComposer><Bloom intensity={0.9} luminanceThreshold={0.15} luminanceSmoothing={0.4} mipmapBlur /></EffectComposer>
    </>
  );
}

function narrate(result: BacktestResult, mc: MonteCarlo | null): string {
  const m = result.metrics;
  if (!mc) return `Backtested ${m.trades} trades → ${m.totalReturnPct >= 0 ? "+" : ""}${m.totalReturnPct}% total, Sharpe ${m.sharpe}. Run more history for a probability cone.`;
  return `Across ${mc.runs} reshuffled futures, ${mc.winProb}% stay profitable. The middle path returns ${mc.retP50 >= 0 ? "+" : ""}${mc.retP50}%; the unlucky 5% draw down ${Math.abs(mc.ddP95)}%. Sharpe ${m.sharpe}, Calmar ${m.calmar}.`;
}

export default function ForgeOracle({ result, mc, name, onClose }: { result: BacktestResult; mc: MonteCarlo | null; name: string; onClose: () => void }) {
  return (
    <div className="oracle-back">
      <div className="oracle-hud-top">
        <div><span className="oracle-kicker">THE ORACLE · PROJECTION</span><span className="oracle-name">{name}</span></div>
        <button className="fg-btn" onClick={onClose}>✕ Collapse</button>
      </div>
      <Canvas camera={{ position: [0, 5, 22], fov: 52 }} dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <Scene result={result} mc={mc} />
      </Canvas>
      <div className="oracle-narrate"><span className="oracle-jarvis">◈ Jarvis</span>{narrate(result, mc)}</div>
    </div>
  );
}
