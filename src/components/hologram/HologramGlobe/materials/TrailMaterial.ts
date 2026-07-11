import * as THREE from "three";

export type TrailMaterialOptions = {
  colorA: THREE.ColorRepresentation;
  colorB: THREE.ColorRepresentation;
  opacity: number;
  speed: number;
  offset: number;
};

export function createTrailMaterial({
  colorA,
  colorB,
  opacity,
  speed,
  offset
}: TrailMaterialOptions) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
      uOffset: { value: offset },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFront;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec3 radialNormal = normalize(mat3(modelMatrix) * normalize(position));
        vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
        vFront = smoothstep(-0.42, 0.52, dot(radialNormal, viewDirection));
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uOpacity;
      uniform float uSpeed;
      uniform float uOffset;
      uniform float uTime;

      varying vec2 vUv;
      varying float vFront;

      void main() {
        float endFade = smoothstep(0.0, 0.13, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
        float moving = fract(vUv.x * 1.15 - uTime * uSpeed + uOffset);
        float head = pow(smoothstep(0.65, 1.0, moving), 7.0);
        float shimmer = 0.88 + 0.12 * sin(vUv.x * 55.0 + uTime * uSpeed * 18.0);
        vec3 color = mix(uColorA, uColorB, clamp(vUv.x * 0.55 + head * 0.7, 0.0, 1.0));
        color *= 0.82 + head * 1.75;
        float alpha = endFade * uOpacity * mix(0.16, 1.0, vFront) * shimmer * (0.74 + head * 1.15);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
}
