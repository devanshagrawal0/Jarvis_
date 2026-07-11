/* THE FORGE — F4 Terraform 3D view. Renders the parameter-fitness landscape as an
   orbitable terrain: height = risk-adjusted return, colour = robustness (green
   plateau = safe, red spike = overfit trap). A marker sits on the robust optimum.
   Lazy-mounted r3f (only when opened) so three is never paid at idle. */

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { TerrainResult } from "./improver/terraform";

const W = 16, HGT = 7;

function Surface({ t }: { t: TerrainResult }) {
  const geom = useMemo(() => {
    const G = t.G; const g = new THREE.BufferGeometry();
    const rg = (t.fMax - t.fMin) || 1;
    const pos: number[] = [], col: number[] = [];
    const cell = (xi: number, yi: number) => t.cells.find(c => c.xi === xi && c.yi === yi)!;
    const cold = new THREE.Color("#ff7285"), warm = new THREE.Color("#4dffb0"), ice = new THREE.Color("#eaf6ff");
    for (let xi = 0; xi < G; xi++) for (let yi = 0; yi < G; yi++) {
      const c = cell(xi, yi);
      pos.push((xi / (G - 1) - 0.5) * W, ((c.fitness - t.fMin) / rg) * HGT, (yi / (G - 1) - 0.5) * W);
      const base = cold.clone().lerp(warm, c.robust);          // red cliff → green plateau
      base.lerp(ice, 0.25 * ((c.fitness - t.fMin) / rg));       // brighten by height
      col.push(base.r, base.g, base.b);
    }
    const idx: number[] = [];
    for (let xi = 0; xi < G - 1; xi++) for (let yi = 0; yi < G - 1; yi++) {
      const a = xi * G + yi, b = a + 1, cc = a + G, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }, [t]);

  const G = t.G, rg = (t.fMax - t.fMin) || 1;
  const bx = (t.best.xi / (G - 1) - 0.5) * W, by = ((t.best.fitness - t.fMin) / rg) * HGT, bz = (t.best.yi / (G - 1) - 0.5) * W;
  return (
    <>
      <mesh geometry={geom}><meshStandardMaterial vertexColors flatShading roughness={0.55} metalness={0.2} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geom}><meshBasicMaterial vertexColors wireframe transparent opacity={0.12} /></mesh>
      {/* robust-optimum marker */}
      <mesh position={[bx, by + 0.7, bz]}><sphereGeometry args={[0.28, 16, 16]} /><meshBasicMaterial color="#ffffff" /></mesh>
      <Html position={[bx, by + 1.4, bz]} center className="terra-tag">robust optimum · SL {t.best.xv}% / TP {t.best.yv}%</Html>
      <Html position={[-W / 2, 0, W / 2 + 1]} className="terra-axis">{t.xLabel} →</Html>
      <Html position={[W / 2 + 1, 0, -W / 2]} className="terra-axis">{t.yLabel} →</Html>
    </>
  );
}

export function ForgeTerraform({ terrain, onClose, onApply }: { terrain: TerrainResult; onClose: () => void; onApply: () => void }) {
  return (
    <div className="terra-back">
      <div className="terra-hud">
        <div><span className="oracle-kicker">TERRAFORM · PARAMETER LANDSCAPE</span><span className="oracle-name">Hunt the plateau, not the spike</span></div>
        <div className="terra-acts"><button className="fg-btn primary" onClick={onApply}>✓ Apply robust optimum</button><button className="fg-btn" onClick={onClose}>✕ Close</button></div>
      </div>
      <Canvas camera={{ position: [14, 12, 16], fov: 50 }} dpr={[1, 1.6]} gl={{ antialias: true }}>
        <color attach="background" args={["#06070b"]} />
        <ambientLight intensity={0.6} /><directionalLight position={[10, 18, 8]} intensity={1.1} /><directionalLight position={[-8, 6, -10]} intensity={0.4} color="#9fb2c6" />
        <Surface t={terrain} />
        <OrbitControls enablePan={false} minDistance={12} maxDistance={40} autoRotate autoRotateSpeed={0.5} maxPolarAngle={Math.PI * 0.49} />
        <EffectComposer><Bloom intensity={0.7} luminanceThreshold={0.5} mipmapBlur /></EffectComposer>
      </Canvas>
      <div className="terra-legend"><span><i style={{ background: "#4dffb0" }} />robust plateau (safe)</span><span><i style={{ background: "#eaf6ff" }} />high return</span><span><i style={{ background: "#ff7285" }} />spiky cliff (overfit trap)</span></div>
    </div>
  );
}
