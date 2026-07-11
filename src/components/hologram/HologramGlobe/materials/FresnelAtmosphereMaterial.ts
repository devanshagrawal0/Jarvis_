import * as THREE from "three";

export type FresnelAtmosphereOptions = {
  color?: THREE.ColorRepresentation;
  accentColor?: THREE.ColorRepresentation;
  intensity?: number;
  power?: number;
  width?: number;
  breakupMap?: THREE.Texture;
};

const fallbackBreakup = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
})();

export function createFresnelAtmosphereMaterial({
  color = "#4CBFFF",
  accentColor = "#D9F8FF",
  intensity = 0.17,
  power = 5.5,
  width = 0.72,
  breakupMap = fallbackBreakup
}: FresnelAtmosphereOptions = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uAccentColor: { value: new THREE.Color(accentColor) },
      uIntensity: { value: intensity },
      uPower: { value: power },
      uWidth: { value: width },
      uTime: { value: 0 },
      uBreakupMap: { value: breakupMap },
      uUseBreakup: { value: breakupMap === fallbackBreakup ? 0 : 1 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewNormal;
      varying vec3 vViewDirection;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 viewPosition = viewMatrix * worldPosition;
        vWorldPosition = worldPosition.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        vUv = uv;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uAccentColor;
      uniform float uIntensity;
      uniform float uPower;
      uniform float uWidth;
      uniform float uTime;
      uniform sampler2D uBreakupMap;
      uniform float uUseBreakup;

      varying vec3 vViewNormal;
      varying vec3 vViewDirection;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      void main() {
        float facing = abs(dot(normalize(vViewNormal), normalize(vViewDirection)));
        float rim = pow(clamp(1.0 - facing, 0.0, 1.0), uPower);
        rim *= smoothstep(0.22, uWidth, 1.0 - facing);
        float breakup = 0.66 + 0.34 * sin(vWorldPosition.y * 53.0 - uTime * 0.12);
        float authoredBreakup = mix(1.0, texture2D(uBreakupMap, vUv).r, uUseBreakup);
        vec3 accentDirection = normalize(vec3(-0.78, 0.64, 0.18));
        float directionalAccent = smoothstep(-0.18, 0.82, dot(normalize(vWorldPosition), accentDirection));
        directionalAccent = pow(directionalAccent, 1.75);
        float lowerDiffusion = smoothstep(-0.9, -0.34, -normalize(vWorldPosition).y) * 0.28;
        float directionalStrength = 0.025 + directionalAccent * 1.35 + lowerDiffusion;
        float alpha = rim * uIntensity * breakup * mix(0.2, 0.96, authoredBreakup) * directionalStrength;
        vec3 rimColor = mix(uColor, uAccentColor, directionalAccent * 0.74);
        gl_FragColor = vec4(rimColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    toneMapped: true
  });
}
