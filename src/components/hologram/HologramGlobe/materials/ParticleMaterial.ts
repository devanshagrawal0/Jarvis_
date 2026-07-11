import * as THREE from "three";

export type ParticleMaterialOptions = {
  colorA?: THREE.ColorRepresentation;
  colorB?: THREE.ColorRepresentation;
  size?: number;
  opacity?: number;
  intensity?: number;
  backOpacity?: number;
  volume?: boolean;
  pulseStrength?: number;
  densityMap?: THREE.Texture;
  hotspotMap?: THREE.Texture;
  landMap?: THREE.Texture;
  useMasks?: boolean;
};

const fallbackTexture = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
})();

export function createParticleMaterial({
  colorA = "#1D7EFF",
  colorB = "#A7F1FF",
  size = 1.15,
  opacity = 0.72,
  intensity = 1,
  backOpacity = 0.08,
  volume = false,
  pulseStrength = 0.08,
  densityMap = fallbackTexture,
  hotspotMap = fallbackTexture,
  landMap = fallbackTexture,
  useMasks = false
}: ParticleMaterialOptions = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uSize: { value: size },
      uOpacity: { value: opacity },
      uIntensity: { value: intensity },
      uBackOpacity: { value: backOpacity },
      uVolume: { value: volume ? 1 : 0 },
      uPulseStrength: { value: pulseStrength },
      uPixelRatio: { value: 1 },
      uTime: { value: 0 },
      uDensityMap: { value: densityMap },
      uHotspotMap: { value: hotspotMap },
      uLandMap: { value: landMap },
      uUseMasks: { value: useMasks ? 1 : 0 }
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;
      attribute float aBrightness;
      attribute float aPhase;
      attribute vec3 aNormal;
      attribute vec2 aUv;

      varying float vBrightness;
      varying float vSeed;
      varying float vPulse;
      varying float vKeep;
      varying float vHotspot;

      uniform float uSize;
      uniform float uBackOpacity;
      uniform float uVolume;
      uniform float uPulseStrength;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform sampler2D uDensityMap;
      uniform sampler2D uHotspotMap;
      uniform sampler2D uLandMap;
      uniform float uUseMasks;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 viewPosition = viewMatrix * worldPosition;
        vec3 viewNormal = normalize(normalMatrix * aNormal);
        vec3 viewDirection = normalize(-viewPosition.xyz);
        float facing = dot(viewNormal, viewDirection);
        float frontVisibility = mix(uBackOpacity, 1.0, smoothstep(-0.28, 0.72, facing));
        float visibility = mix(frontVisibility, 1.0, uVolume);
        float pulse = 1.0 + sin(uTime * 0.78 + aPhase) * uPulseStrength;
        float densitySample = texture2D(uDensityMap, aUv).r;
        float hotspot = mix(0.0, texture2D(uHotspotMap, aUv).r, uUseMasks);
        float land = mix(0.0, texture2D(uLandMap, aUv).r, uUseMasks);
        float density = mix(
          1.0,
          clamp(densitySample * 1.02 + land * 0.2 + 0.22, 0.0, 1.0),
          uUseMasks
        );
        float keep = smoothstep(aSeed - 0.12, aSeed + 0.08, density);

        float concentratedHotspot = pow(hotspot, 2.15);
        vBrightness = aBrightness * visibility * mix(0.04, 1.0, keep) * (1.0 + concentratedHotspot * 3.4) * (1.0 + land * 0.26);
        vSeed = aSeed;
        vPulse = pulse;
        vKeep = keep;
        vHotspot = hotspot;
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = max(
          0.45,
          uSize * aSize * uPixelRatio * (7.2 / max(2.2, -viewPosition.z)) * mix(0.45, 1.0, keep) * (1.0 + concentratedHotspot * 0.48)
        );
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vBrightness;
      varying float vSeed;
      varying float vPulse;
      varying float vKeep;
      varying float vHotspot;

      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uOpacity;
      uniform float uIntensity;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered);
        if (radius > 0.5) discard;

        float core = smoothstep(0.17, 0.0, radius);
        float body = smoothstep(0.5, 0.13, radius);
        float colorMix = clamp(vSeed * 0.76 + core * 0.24, 0.0, 1.0);
        vec3 color = mix(uColorA, uColorB, clamp(colorMix + vHotspot * 0.3, 0.0, 1.0)) * uIntensity;
        float alpha = (body * 0.42 + core * 0.72) * uOpacity * vBrightness * vPulse * mix(0.1, 1.0, vKeep);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: !volume,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
}
