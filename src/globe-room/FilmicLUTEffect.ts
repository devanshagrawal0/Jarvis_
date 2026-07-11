import * as THREE from "three";
import { Effect } from "postprocessing";

/**
 * Applies Blender's EXACT view transform (Filmic + High Contrast look,
 * exposure -0.06), baked into /globe-room/filmic_lut.png by
 * bake_filmic_lut.py. LUT pixel i = display value of linear (i/4095)² × 8.
 *
 * The PNG stores display-referred sRGB; loading it with SRGBColorSpace makes
 * sampling return linearized-display values, so the composer's final sRGB
 * output encode reproduces the display value exactly.
 */
const fragmentShader = /* glsl */ `
  uniform sampler2D lutTex;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = clamp(inputColor.rgb, 0.0, 8.0);
    vec3 u = sqrt(c / 8.0);
    float r = texture2D(lutTex, vec2(u.r, 0.5)).r;
    float g = texture2D(lutTex, vec2(u.g, 0.5)).r;
    float b = texture2D(lutTex, vec2(u.b, 0.5)).r;
    outputColor = vec4(r, g, b, inputColor.a);
  }
`;

export class FilmicLUTEffect extends Effect {
  constructor(lut: THREE.Texture) {
    super("FilmicLUTEffect", fragmentShader, {
      uniforms: new Map<string, THREE.Uniform>([["lutTex", new THREE.Uniform(lut)]])
    });
  }
}

export function loadFilmicLut(): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      "/globe-room/filmic_lut.png",
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.generateMipmaps = false;
        resolve(t);
      },
      undefined,
      reject
    );
  });
}
