import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ModeId } from "./types";

const modeColors: Record<ModeId, string> = {
  main: "#7ce8ff",
  focus: "#68aaff",
  plan: "#ffbc60",
  command: "#7ce8ff",
  workpad: "#e6f6ff",
  browser: "#75f4ff",
  markets: "#62f6ba",
  projects: "#8fb9ff",
  vision: "#ff8adf",
  canvas: "#c0a2ff",
  agents: "#ffc26f",
  phone: "#9cff91",
  study: "#ffe082",
  prepare: "#ff9b96",
  media: "#75f4ff",
  settings: "#d5edf2"
};

type HoloSceneProps = {
  mode: ModeId;
  intensity: number;
};

export function HoloScene({ mode, intensity }: HoloSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  const intensityRef = useRef(intensity);

  useEffect(() => {
    modeRef.current = mode;
    intensityRef.current = intensity;
  }, [mode, intensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
    const table = new THREE.Group();
    const globe = new THREE.Group();
    const rings = new THREE.Group();
    const particles = new THREE.Group();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.position.set(0, 5.6, 10.5);
    camera.lookAt(0, 0.25, 0);

    scene.add(new THREE.AmbientLight(0x89f3ff, 1.2));
    const key = new THREE.PointLight(0x78edff, 42, 22);
    key.position.set(0, 4, 5);
    scene.add(key);

    const baseMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.5 });
    const floorGeometry = new THREE.BufferGeometry();
    const floorPoints: number[] = [];
    const size = 12;
    const step = 0.75;
    for (let i = -size; i <= size; i += step) {
      floorPoints.push(-size, 0, i, size, 0, i);
      floorPoints.push(i, 0, -size, i, 0, size);
    }
    floorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(floorPoints, 3));
    const floorGrid = new THREE.LineSegments(floorGeometry, baseMaterial.clone());
    floorGrid.position.y = -1.95;
    table.add(floorGrid);

    const globeWire = new THREE.Mesh(
      new THREE.SphereGeometry(1.65, 36, 18),
      new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.16, wireframe: true })
    );
    globeWire.position.y = 0.35;
    globe.add(globeWire);

    const latitudeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
    for (let i = -3; i <= 3; i += 1) {
      const radius = Math.sqrt(Math.max(0.01, 1.65 * 1.65 - (i * 0.4) ** 2));
      const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(96).map((point) => new THREE.Vector3(point.x, i * 0.4 + 0.35, point.y)));
      globe.add(new THREE.LineLoop(geometry, latitudeMaterial.clone()));
    }

    for (let i = 0; i < 5; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.25 + i * 0.34, 0.006, 8, 160),
        new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.42 - i * 0.045 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = i * 0.42;
      ring.userData.speed = 0.003 + i * 0.0007;
      rings.add(ring);
    }

    const pointCount = 360;
    const pointGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.2 + Math.random() * 4.2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -1.4 + Math.random() * 2.7;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pointCloud = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({ color: 0x7ce8ff, size: 0.014, transparent: true, opacity: 0.48 })
    );
    particles.add(pointCloud);

    scene.add(table, rings, globe, particles);

    let frame = 0;
    let animationId = 0;
    const started = performance.now();

    const render = () => {
      animationId = requestAnimationFrame(render);
      frame = (performance.now() - started) / 1000;
      const color = new THREE.Color(modeColors[modeRef.current]);
      const opacity = 0.22 + Math.min(0.4, intensityRef.current / 240);

      scene.traverse((object) => {
        const material = (object as THREE.Mesh | THREE.Line | THREE.Points).material as THREE.Material | undefined;
        if (material && "color" in material) {
          (material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial | THREE.PointsMaterial).color.copy(color);
        }
      });

      globe.rotation.y += 0.0028;
      globe.rotation.x = Math.sin(frame * 0.27) * 0.06;
      rings.children.forEach((ring) => {
        ring.rotation.z += ring.userData.speed;
      });
      particles.rotation.y -= 0.0009;
      floorGrid.position.z = Math.sin(frame * 0.5) * 0.05;
      (globeWire.material as THREE.MeshBasicMaterial).opacity = opacity;
      renderer.render(scene, camera);
    };

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };

    window.addEventListener("resize", resize);
    render();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });
    };
  }, []);

  return <canvas ref={canvasRef} className="holo-scene" data-testid="holo-scene" />;
}
