import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Blender render specs: 1920x1080, fov_v=41.11°, near=0.1, far=1000
const RENDER_W = 1920;
const RENDER_H = 1080;
const BLENDER_FOV_V = 41.11209043916693;
const BLENDER_NEAR = 0.1;
const BLENDER_FAR = 1000;

export interface ScreenRects {
  left: DOMRect | null;
  right: DOMRect | null;
}

interface Props {
  onScreenRects?: (rects: ScreenRects) => void;
}

function makeCamera(aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(BLENDER_FOV_V, aspect, BLENDER_NEAR, BLENDER_FAR);
  return cam;
}

function projectBox(box: THREE.Box3, camera: THREE.PerspectiveCamera, W: number, H: number): DOMRect {
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    const p = c.clone().project(camera);
    const sx = (p.x * 0.5 + 0.5) * W;
    const sy = (-p.y * 0.5 + 0.5) * H;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}

export function JarvisBackground({ onScreenRects }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = window.innerWidth;
    const H = window.innerHeight;

    // Globe renderer — transparent so PNG background shows through
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = makeCamera(W / H);

    // Ambient light so globe materials are visible even without Blender lights
    scene.add(new THREE.AmbientLight(0x4488ff, 0.4));
    scene.add(new THREE.DirectionalLight(0x88ccff, 1.2));

    let globeRoot: THREE.Object3D | null = null;
    let rafId = 0;

    const globeLoader = new GLTFLoader();
    globeLoader.load("/jarvis_globe.glb", (gltf) => {
      scene.add(gltf.scene);
      globeRoot = gltf.scene;

      // Use Blender camera transform
      gltf.scene.traverse((obj) => {
        if ((obj as any).isCamera && obj instanceof THREE.PerspectiveCamera) {
          camera.position.copy(obj.getWorldPosition(new THREE.Vector3()));
          camera.quaternion.copy(obj.getWorldQuaternion(new THREE.Quaternion()));
          camera.fov = BLENDER_FOV_V;
          camera.aspect = W / H;
          camera.near = BLENDER_NEAR;
          camera.far = BLENDER_FAR;
          camera.updateProjectionMatrix();
        }
      });
    }, undefined, (err) => console.error("[JarvisBackground] globe load error:", err));

    // Load screens GLB just for position projection
    const screenLoader = new GLTFLoader();
    screenLoader.load("/jarvis_screens.glb", (gltf) => {
      // Use same Blender camera
      gltf.scene.traverse((obj) => {
        if ((obj as any).isCamera && obj instanceof THREE.PerspectiveCamera) {
          camera.position.copy(obj.getWorldPosition(new THREE.Vector3()));
          camera.quaternion.copy(obj.getWorldQuaternion(new THREE.Quaternion()));
          camera.fov = BLENDER_FOV_V;
          camera.aspect = W / H;
          camera.near = BLENDER_NEAR;
          camera.far = BLENDER_FAR;
          camera.updateProjectionMatrix();
        }
      });

      if (!onScreenRects) return;
      let leftRect: DOMRect | null = null;
      let rightRect: DOMRect | null = null;
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const box = new THREE.Box3().setFromObject(obj);
          if (obj.name === "Screen_L_glass") leftRect = projectBox(box, camera, W, H);
          if (obj.name === "Screen_R_glass") rightRect = projectBox(box, camera, W, H);
        }
      });
      onScreenRects({ left: leftRect, right: rightRect });
    }, undefined, (err) => console.error("[JarvisBackground] screens load error:", err));

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (globeRoot) globeRoot.rotation.y += 0.0008;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}
    />
  );
}
